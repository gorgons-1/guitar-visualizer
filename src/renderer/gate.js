/*
 * NoteGate: turns raw pitch frames into a stable "note being played".
 * In guitar-only mode it ignores voices and background noise by requiring what a
 * plucked string has and a voice usually doesn't:
 *   1. a sharp attack (sudden jump in level) shortly before a new note starts,
 *   2. a clean, strongly periodic tone (high clarity),
 *   3. a steady pitch (no wobble, slides or vibrato).
 * Works in the browser (window.NoteGate) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoteGate = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const cents = (a, b) => 1200 * Math.log2(a / b);
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  class NoteGate {
    constructor(opts = {}) {
      this.guitarOnly = opts.guitarOnly ?? true;
      this.minClarity = opts.minClarity ?? 0.88; // how "clean" the tone must be
      this.maxWobble = opts.maxWobble ?? 25; // cents of pitch drift allowed across 3 frames
      this.attackWindow = opts.attackWindow ?? 500; // ms after a pluck in which a new note may start
      this.attackRatio = opts.attackRatio ?? 2; // level jump that counts as a pluck (2x = +6 dB)
      this.threshold = opts.threshold ?? 0.01; // noise gate (input level)
      this.reset();
    }

    reset() {
      this.attackLevels = [];
      this.freqs = [];
      this.lastAttack = -Infinity;
      this.note = null;
      this.silent = 0;
      this.candidate = null;
      this.candidateCount = 0;
    }

    /**
     * @param {{level:number, attackLevel:number, freq:number, clarity:number}} frame
     *   level: RMS of the analysis window; attackLevel: RMS of only the newest few ms.
     * @param {number} now  time in ms
     * @returns {{midi:number, freq:number, cents:number}|null} the note to show
     */
    push(frame, now) {
      // 1. Pluck detection from the newest samples.
      const prev = this.attackLevels.slice(-3);
      if (prev.length && frame.attackLevel > this.threshold * 2 && frame.attackLevel > this.attackRatio * Math.min(...prev)) {
        this.lastAttack = now;
      }
      this.attackLevels.push(frame.attackLevel);
      if (this.attackLevels.length > 6) this.attackLevels.shift();

      // 2. Reject frames with no pitch or (guitar-only) an unclean tone. Hold the note briefly.
      const usable = frame.freq > 0 && frame.level >= this.threshold && (!this.guitarOnly || frame.clarity >= this.minClarity);
      if (!usable) {
        if (++this.silent > 8) {
          this.note = null;
          this.freqs = [];
        }
        return this.note;
      }
      this.silent = 0;
      this.freqs.push(frame.freq);
      if (this.freqs.length > 5) this.freqs.shift();

      const f = median(this.freqs);
      const m = 69 + 12 * Math.log2(f / 440);
      const midi = Math.round(m);
      const c = Math.round((m - midi) * 100);

      if (this.note && midi === this.note.midi) {
        this.note = { midi, freq: f, cents: c };
        return this.note;
      }

      if (!this.guitarOnly) {
        if (midi === this.candidate) this.candidateCount++;
        else { this.candidate = midi; this.candidateCount = 1; }
        if (this.candidateCount >= 2) this.note = { midi, freq: f, cents: c };
        return this.note;
      }

      // 3. Guitar-only: a new note needs a steady pitch...
      const last3 = this.freqs.slice(-3);
      if (last3.length < 3) return this.note;
      const wobble = cents(Math.max(...last3), Math.min(...last3));
      if (wobble > this.maxWobble) return this.note;
      // ...and must follow a pluck, unless a guitar note is already ringing (hammer-ons, slides).
      const plucked = now - this.lastAttack <= this.attackWindow;
      if (!plucked && !this.note) return this.note;

      const settled = median(last3);
      const sm = 69 + 12 * Math.log2(settled / 440);
      const smidi = Math.round(sm);
      this.note = { midi: smidi, freq: settled, cents: Math.round((sm - smidi) * 100) };
      return this.note;
    }
  }

  return NoteGate;
});
