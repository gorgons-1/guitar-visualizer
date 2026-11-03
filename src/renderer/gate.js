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
      this.maxWobble = opts.maxWobble ?? 15; // cents of pitch drift allowed while a note settles
      this.attackWindow = opts.attackWindow ?? 500; // ms after a pluck in which a new note may start
      this.attackRatio = opts.attackRatio ?? 1.8; // level jump that counts as a pluck (~+5 dB)
      this.holdMs = opts.holdMs ?? 250; // keep showing a note this long through gaps
      this.maxRiseMs = opts.maxRiseMs ?? 80; // a pluck is at full volume within this time
      this.stableFrames = opts.stableFrames ?? 4; // readings that must agree before a new note shows
      this.threshold = opts.threshold ?? 0.01; // noise gate (input level)
      this.reset();
    }

    reset() {
      this.attackLevels = [];
      this.freqs = [];
      this.lastAttack = -Infinity;
      this.attackStart = -Infinity;
      this.peakLevel = 0; // loudest point since the onset
      this.peakTime = -Infinity; // when it got there
      this.note = null;
      this.lastUsable = -Infinity;
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
      if (prev.length && frame.attackLevel > this.threshold && frame.attackLevel > this.attackRatio * Math.min(...prev)) {
        // A slow fade-in triggers this several frames in a row; treat that as one onset.
        if (now - this.lastAttack > 100) {
          this.attackStart = now;
          this.peakLevel = frame.level;
          this.peakTime = now;
        }
        this.lastAttack = now;
      }
      // Track how long the sound keeps getting louder after the onset.
      if (now - this.attackStart <= 400 && frame.level > this.peakLevel * 1.03) {
        this.peakLevel = frame.level;
        this.peakTime = now;
      }
      this.attackLevels.push(frame.attackLevel);
      if (this.attackLevels.length > 6) this.attackLevels.shift();

      // 2. Reject frames with no pitch or (guitar-only) an unclean tone. Hold the note briefly.
      // Hysteresis: a note must pass the gate to start, but is followed down to half that level.
      const usable = frame.freq > 0 && frame.level >= this.threshold * 0.5 && (!this.guitarOnly || frame.clarity >= this.minClarity);
      if (!usable) {
        if (now - this.lastUsable > this.holdMs) {
          this.note = null;
          this.freqs = [];
        }
        return this.note;
      }
      this.lastUsable = now;
      this.freqs.push(frame.freq);
      if (this.freqs.length > Math.max(3, this.stableFrames)) this.freqs.shift();

      const f = median(this.freqs.slice(-3));
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
      const last3 = this.freqs.slice(-this.stableFrames);
      if (last3.length < this.stableFrames) return this.note;
      const wobble = cents(Math.max(...last3), Math.min(...last3));
      if (wobble > this.maxWobble) return this.note;
      // ...and must follow a pluck, unless a guitar note is already ringing (hammer-ons, slides).
      // A pluck reaches full volume almost at once (~50 ms, the analysis window filling up);
      // a voice fading in keeps getting louder for much longer.
      const quickRise = this.peakTime - this.attackStart <= this.maxRiseMs && now - this.peakTime >= 0;
      const plucked = now - this.attackStart <= this.attackWindow && quickRise;
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
