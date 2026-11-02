/* Music theory helpers. Works in the browser (window.Theory) and in Node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Theory = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const INTERVALS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

  const SCALES = {
    major: { name: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: 'Natural Minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10] },
    majorPentatonic: { name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
    minorPentatonic: { name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
    blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
    harmonicMinor: { name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
    melodicMinor: { name: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
    dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
    locrian: { name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
    chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  };

  const CHORDS = {
    maj: { name: 'Major', symbol: '', intervals: [0, 4, 7] },
    min: { name: 'Minor', symbol: 'm', intervals: [0, 3, 7] },
    '7': { name: 'Dominant 7', symbol: '7', intervals: [0, 4, 7, 10] },
    maj7: { name: 'Major 7', symbol: 'maj7', intervals: [0, 4, 7, 11] },
    m7: { name: 'Minor 7', symbol: 'm7', intervals: [0, 3, 7, 10] },
    sus2: { name: 'Sus 2', symbol: 'sus2', intervals: [0, 2, 7] },
    sus4: { name: 'Sus 4', symbol: 'sus4', intervals: [0, 5, 7] },
    '6': { name: 'Major 6', symbol: '6', intervals: [0, 4, 7, 9] },
    m6: { name: 'Minor 6', symbol: 'm6', intervals: [0, 3, 7, 9] },
    add9: { name: 'Add 9', symbol: 'add9', intervals: [0, 4, 7, 14] },
    '9': { name: 'Dominant 9', symbol: '9', intervals: [0, 4, 7, 10, 14] },
    dim: { name: 'Diminished', symbol: 'dim', intervals: [0, 3, 6] },
    dim7: { name: 'Diminished 7', symbol: 'dim7', intervals: [0, 3, 6, 9] },
    m7b5: { name: 'Half-diminished', symbol: 'm7b5', intervals: [0, 3, 6, 10] },
    aug: { name: 'Augmented', symbol: 'aug', intervals: [0, 4, 8] },
    '5': { name: 'Power chord', symbol: '5', intervals: [0, 7] },
  };

  // MIDI note numbers, lowest string first.
  const TUNINGS = {
    standard: { name: 'Standard (EADGBE)', notes: [40, 45, 50, 55, 59, 64] },
    dropD: { name: 'Drop D (DADGBE)', notes: [38, 45, 50, 55, 59, 64] },
    eb: { name: 'Eb Standard', notes: [39, 44, 49, 54, 58, 63] },
    dStandard: { name: 'D Standard', notes: [38, 43, 48, 53, 57, 62] },
    dropC: { name: 'Drop C (CGCFAD)', notes: [36, 43, 48, 53, 57, 62] },
    dadgad: { name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
    openG: { name: 'Open G (DGDGBD)', notes: [38, 43, 50, 55, 59, 62] },
    openD: { name: 'Open D (DADF#AD)', notes: [38, 45, 50, 54, 57, 62] },
    openE: { name: 'Open E (EBEG#BE)', notes: [40, 47, 52, 56, 59, 64] },
    sevenString: { name: '7-string (BEADGBE)', notes: [35, 40, 45, 50, 55, 59, 64] },
    bass4: { name: 'Bass 4-string (EADG)', notes: [28, 33, 38, 43] },
  };

  const pc = (midi) => ((Math.round(midi) % 12) + 12) % 12;
  const noteName = (pitchClass, useFlats) => (useFlats ? FLATS : SHARPS)[pc(pitchClass)];
  const noteNameWithOctave = (midi, useFlats) => noteName(midi, useFlats) + (Math.floor(Math.round(midi) / 12) - 1);
  const intervalName = (rootPc, notePc) => INTERVALS[pc(notePc - rootPc)];
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const freqToMidi = (freq) => 69 + 12 * Math.log2(freq / 440);

  function scalePcs(rootPc, scaleId) {
    return SCALES[scaleId].steps.map((s) => pc(rootPc + s));
  }

  function chordPcs(rootPc, chordId) {
    return [...new Set(CHORDS[chordId].intervals.map((s) => pc(rootPc + s)))];
  }

  /** Every playable position on the neck. */
  function fretboard(tuning, frets) {
    const out = [];
    tuning.forEach((open, string) => {
      for (let fret = 0; fret <= frets; fret++) out.push({ string, fret, midi: open + fret, pc: pc(open + fret) });
    });
    return out;
  }

  /** Ascending then descending run of the given pitch classes, starting at the lowest root on the neck. */
  function buildRun(tuning, rootPc, pcs, octaves = 1) {
    let start = tuning[0];
    while (pc(start) !== pc(rootPc)) start++;
    const end = start + 12 * octaves;
    const set = new Set(pcs);
    const up = [];
    for (let m = start; m <= end; m++) if (set.has(pc(m))) up.push(m);
    return up.concat(up.slice(0, -1).reverse());
  }

  /**
   * Find playable chord voicings.
   * Returns arrays (one entry per string, low to high): fret number, or null for muted.
   */
  function findVoicings(tuning, rootPc, chordId, opts = {}) {
    const maxFret = opts.maxFret ?? 15;
    const span = opts.span ?? 4;
    const limit = opts.limit ?? 40;
    const n = tuning.length;
    const tones = chordPcs(rootPc, chordId);
    const toneSet = new Set(tones);
    // For 5-note chords the perfect fifth may be left out.
    const fifth = pc(rootPc + 7);
    const required = tones.length >= 5 ? tones.filter((t) => t !== fifth) : tones;
    const minStrings = Math.min(tones.length === 2 ? 2 : n >= 6 ? 4 : 3, n);
    const found = new Map();

    for (let start = 0; start + span - 1 <= Math.max(maxFret, span - 1); start++) {
      const lo = Math.max(1, start);
      const hi = Math.min(start + span - 1, maxFret);
      const allowOpen = start <= 3;
      const options = tuning.map((open) => {
        const o = [null];
        if (allowOpen && toneSet.has(pc(open))) o.push(0);
        for (let f = lo; f <= hi; f++) if (toneSet.has(pc(open + f))) o.push(f);
        return o;
      });

      const choice = new Array(n);
      const walk = (s) => {
        if (s === n) return evaluate(choice.slice());
        for (const f of options[s]) {
          choice[s] = f;
          walk(s + 1);
        }
      };
      walk(0);
    }

    function evaluate(v) {
      const sounding = [];
      v.forEach((f, s) => f !== null && sounding.push(s));
      if (sounding.length < minStrings) return;
      // Sounding strings must be adjacent (no muted string in the middle).
      if (sounding[sounding.length - 1] - sounding[0] + 1 !== sounding.length) return;
      // Root in the bass.
      if (pc(tuning[sounding[0]] + v[sounding[0]]) !== pc(rootPc)) return;
      const present = new Set(sounding.map((s) => pc(tuning[s] + v[s])));
      if (!required.every((t) => present.has(t))) return;
      // Finger count, treating the lowest fretted fret as a possible barre.
      const fretted = sounding.map((s) => v[s]).filter((f) => f > 0);
      if (fretted.length) {
        const minF = Math.min(...fretted);
        const fingers = fretted.filter((f) => f !== minF).length + 1;
        if (fingers > 4) return;
      }
      const key = v.map((f) => (f === null ? 'x' : f)).join('-');
      if (!found.has(key)) found.set(key, v);
    }

    const position = (v) => Math.min(...v.filter((f) => f !== null));
    const count = (v) => v.filter((f) => f !== null).length;
    return [...found.values()]
      .sort((a, b) => position(a) - position(b) || count(b) - count(a))
      .slice(0, limit);
  }

  const formatVoicing = (v) => v.map((f) => (f === null ? 'x' : f)).join(' ');

  return {
    SHARPS, FLATS, INTERVALS, SCALES, CHORDS, TUNINGS,
    pc, noteName, noteNameWithOctave, intervalName, midiToFreq, freqToMidi,
    scalePcs, chordPcs, fretboard, buildRun, findVoicings, formatVoicing,
  };
});
