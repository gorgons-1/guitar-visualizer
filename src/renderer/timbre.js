/*
 * Timbre-based string detection (experimental).
 *
 * A real string is stiff, so its overtones are slightly sharp:  f_n = n * f0 * sqrt(1 + B * n^2).
 * B ("inharmonicity") is different for every string (thickness, core, tension), and grows as the
 * string is shortened by fretting:  B(fret) = B(open) * 2^(fret / 6).
 * After a one-time calibration (pluck each open string), measuring B for a played note tells us
 * which string it most likely came from.
 *
 * Works in the browser (window.Timbre) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Timbre = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const hannCache = new Map();
  function hann(n) {
    if (!hannCache.has(n)) {
      const w = new Float32Array(n);
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      hannCache.set(n, w);
    }
    return hannCache.get(n);
  }

  /** Magnitude of the windowed signal at an exact frequency (single-bin DFT). */
  function magAt(buf, win, freq, sr) {
    const w = (2 * Math.PI * freq) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    let c = 1, s = 0, re = 0, im = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i] * win[i];
      re += x * c;
      im -= x * s;
      const nc = c * cw - s * sw;
      s = s * cw + c * sw;
      c = nc;
    }
    return Math.hypot(re, im);
  }

  /** Find the spectral peak between lo and hi Hz; returns {freq, mag} with sub-step precision. */
  function peakBetween(buf, win, sr, lo, hi) {
    const step = Math.max(0.25, sr / buf.length / 6);
    let bestF = lo, bestM = -1;
    const pts = [];
    for (let f = lo; f <= hi; f += step) {
      const m = magAt(buf, win, f, sr);
      pts.push([f, m]);
      if (m > bestM) { bestM = m; bestF = f; }
    }
    // Parabolic refinement on log magnitude.
    const i = pts.findIndex((p) => p[0] === bestF);
    if (i > 0 && i < pts.length - 1) {
      const a = Math.log(pts[i - 1][1] + 1e-12), b = Math.log(bestM + 1e-12), c = Math.log(pts[i + 1][1] + 1e-12);
      const den = a - 2 * b + c;
      if (den < 0) bestF += (0.5 * (a - c) / den) * step;
    }
    return { freq: bestF, mag: bestM, edge: i === 0 || i === pts.length - 1 };
  }

  /** Weighted least squares for f_n^2 = A n^2 + C n^4  ->  f0 = sqrt(A), B = C / A. */
  function fit(partials) {
    let s22 = 0, s24 = 0, s44 = 0, y2 = 0, y4 = 0;
    for (const { n, freq, w } of partials) {
      const n2 = n * n, n4 = n2 * n2, y = freq * freq;
      s22 += w * n2 * n2; s24 += w * n2 * n4; s44 += w * n4 * n4;
      y2 += w * n2 * y; y4 += w * n4 * y;
    }
    const det = s22 * s44 - s24 * s24;
    if (!det) return null;
    const A = (y2 * s44 - y4 * s24) / det;
    const C = (s22 * y4 - s24 * y2) / det;
    if (A <= 0) return null;
    return { f0: Math.sqrt(A), B: C / A };
  }

  /**
   * Measure inharmonicity of a sustained note.
   * @param {Float32Array} buf  >= ~100 ms of the note (attack excluded), mono
   * @param {number} sr  sample rate
   * @param {number} f0  detected fundamental (Hz)
   * @returns {{B:number, f0:number, partials:number, brightness:number}|null}
   */
  function measure(buf, sr, f0, opts = {}) {
    const maxN = opts.maxPartials ?? 24;
    const maxFreq = Math.min(opts.maxFreq ?? 7000, sr * 0.45);
    const win = hann(buf.length);
    const found = [];
    let B = 0, fEst = f0;
    let maxMag = 0;
    for (let n = 1; n <= maxN && n * f0 * 1.02 < maxFreq; n++) {
      // Predict where partial n should be with the B estimated so far, search a narrow band.
      const pred = n * fEst * Math.sqrt(1 + Math.max(0, B) * n * n);
      const halfWidth = Math.min(0.35 * f0, Math.max(3 * sr / buf.length, pred * (n <= 4 ? 0.012 : 0.004)));
      const pk = peakBetween(buf, win, sr, pred - halfWidth, pred + halfWidth);
      maxMag = Math.max(maxMag, pk.mag);
      if (!pk.edge) found.push({ n, freq: pk.freq, mag: pk.mag });
      // Re-fit as we go so later (more sharpened) partials are predicted well.
      const usable = found.filter((p) => p.mag > maxMag * 0.02);
      if (usable.length >= 4) {
        const r = fit(usable.map((p) => ({ ...p, w: Math.sqrt(p.mag / maxMag) })));
        if (r) { B = r.B; fEst = r.f0; }
      }
    }
    const usable = found.filter((p) => p.mag > maxMag * 0.02);
    if (usable.length < 6) return null;
    const r = fit(usable.map((p) => ({ ...p, w: Math.sqrt(p.mag / maxMag) })));
    if (!r || !(r.B > 0) || r.B > 0.01) return null;
    const total = usable.reduce((a, p) => a + p.mag, 0);
    const brightness = usable.reduce((a, p) => a + p.n * p.mag, 0) / total;
    return { B: r.B, f0: r.f0, partials: usable.length, brightness };
  }

  /** Inharmonicity expected at a fret, from the open-string value. */
  const predictB = (openB, fret) => openB * Math.pow(2, fret / 6);

  /**
   * Rank candidate positions for a note using measured B and calibration.
   * @param {{s:number,f:number}[]} candidates
   * @param {number} measuredB
   * @param {number[]} openB  calibrated open-string B per string
   * @param {(p)=>number} [priorCost]  optional extra cost (e.g. hand distance), 0 = neutral
   * @returns {{best:{s,f}, confidence:number, ranked:{s,f,p:number}[]}}
   */
  function classify(candidates, measuredB, openB, priorCost = () => 0, sigma = 0.35) {
    const lm = Math.log(measuredB);
    const scored = candidates.map((c) => {
      const d = (lm - Math.log(predictB(openB[c.s], c.f))) / sigma;
      return { ...c, logp: -0.5 * d * d - priorCost(c) };
    });
    const max = Math.max(...scored.map((x) => x.logp));
    const sum = scored.reduce((a, x) => a + Math.exp(x.logp - max), 0);
    const ranked = scored.map((x) => ({ s: x.s, f: x.f, p: Math.exp(x.logp - max) / sum })).sort((a, b) => b.p - a.p);
    return { best: { s: ranked[0].s, f: ranked[0].f }, confidence: ranked[0].p, ranked };
  }

  return { measure, classify, predictB, fit };
});
