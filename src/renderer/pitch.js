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
  function detect(buf, sampleRate, opts = {}) {
    const minFreq = opts.minFreq || 60;
    const maxFreq = opts.maxFreq || 1500;
    const threshold = opts.threshold || 0.15;
    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    const tauMax = Math.min(Math.floor(buf.length / 2), Math.ceil(sampleRate / minFreq));
    const width = buf.length - tauMax;
    if (tauMax <= tauMin) return -1;

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
      if (d[best] > 0.35) return -1;
      tau = best;
    }

    // Parabolic interpolation for sub-sample accuracy.
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den) better = tau + (0.5 * (a - c)) / den;
    }
    return sampleRate / better;
  }

  return { rms, detect };
});
