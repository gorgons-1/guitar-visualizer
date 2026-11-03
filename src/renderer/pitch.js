/* Monophonic pitch detection (YIN). Works in the browser (window.Pitch) and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pitch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /**
   * Returns the fundamental frequency in Hz, or -1 if no clear pitch.
   * @param {Float32Array} buf  time-domain samples
   * @param {number} sampleRate
   * @param {{minFreq?:number,maxFreq?:number,threshold?:number}} opts
   */
  function analyze(buf, sampleRate, opts = {}) {
    const none = { freq: -1, clarity: 0 };
    const minFreq = opts.minFreq || 60;
    const maxFreq = opts.maxFreq || 1500;
    const threshold = opts.threshold || 0.15;
    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    const tauMax = Math.min(Math.floor(buf.length / 2), Math.ceil(sampleRate / minFreq));
    const width = buf.length - tauMax;
    if (tauMax <= tauMin) return none;

    // Difference function.
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < width; i++) {
        const x = buf[i] - buf[i + tau];
        sum += x * x;
      }
      d[tau] = sum;
    }

    // Cumulative mean normalised difference.
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running ? (d[tau] * tau) / running : 1;
    }

    // First dip below threshold, then slide to its local minimum.
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau === -1) {
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.35) return none;
      tau = best;
    }

    // Octave check: low guitar strings (especially through a mic) often have a weak
    // fundamental, so the first dip can be an overtone. If a period 2x/3x/4x longer
    // fits clearly better, it is the real note.
    // Only when the sound is steady: at a note change the window holds two different
    // notes, and the check would wrongly drop an octave.
    const half = buf.length >> 1;
    const r1 = rms(buf.subarray(0, half)), r2 = rms(buf.subarray(half));
    const steady = Math.max(r1, r2) <= 1.5 * Math.min(r1, r2);
    // Compare interpolated dip depths: a string's period is rarely a whole number of
    // samples, so raw values at tau vs 2*tau are not comparable.
    const dip = (t) => {
      if (t <= 1 || t >= tauMax) return d[t];
      const a = d[t - 1], b = d[t], c = d[t + 1];
      const den = a - 2 * b + c;
      return den > 0 ? Math.max(0, b - ((a - c) * (a - c)) / (8 * den)) : b;
    };
    const base = tau;
    const baseDip = dip(base);
    for (let k = 2; steady && k <= 4; k++) {
      const centre = base * k;
      if (centre > tauMax) break;
      const lo = Math.max(tauMin, Math.floor(centre - 2 * k));
      const hi = Math.min(tauMax, Math.ceil(centre + 2 * k));
      let best = lo;
      for (let t = lo + 1; t <= hi; t++) if (d[t] < d[best]) best = t;
      const bestDip = dip(best);
      // Must be clearly better: half the error AND a real gap (a true high note fits its
      // own period almost perfectly, so its multiples are never much better).
      if (bestDip < baseDip * 0.3 && baseDip - bestDip > 0.02 && bestDip <= dip(tau)) tau = best;
    }

    // Parabolic interpolation for sub-sample accuracy.
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den) better = tau + (0.5 * (a - c)) / den;
    }
    // clarity: 1 = perfectly periodic (a clean string), lower = breathy / noisy (voices).
    return { freq: sampleRate / better, clarity: Math.max(0, 1 - d[tau]) };
  }

  /** Frequency only (Hz), or -1. */
  function detect(buf, sampleRate, opts = {}) {
    return analyze(buf, sampleRate, opts).freq;
  }

  return { rms, analyze, detect };
});
