/*
 * Chord checking: after a strum, measure how much of each of the 12 notes (C, C#, D, ...) is
 * sounding (a "chroma" profile), then compare with the chord the player is meant to play.
 * Works in the browser (window.ChordCheck) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChordCheck = api;
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

  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /**
   * 12-bin note profile of a sound. Uses notes from E3 up (below that, semitones are too close
   * together to separate in a short window; low notes still show up through their overtones).
   * @returns {number[]} 12 values, normalised so the strongest is 1
   */
  function chroma(buf, sr, { minMidi = 52, lowMidi = 40, maxMidi = 100 } = {}) {
    const win = hann(buf.length);
    const out = new Array(12).fill(0);
    const magOf = (m) => {
      const f = midiFreq(m);
      // allow the guitar to be up to ~25 cents out of tune
      return Math.max(
        magAt(buf, win, f * Math.pow(2, -0.2 / 12), sr),
        magAt(buf, win, f, sr),
        magAt(buf, win, f * Math.pow(2, 0.2 / 12), sr),
      );
    };
    // Low strings (E2..D#3): semitones are only ~5-9 Hz apart, so energy smears into neighbours.
    // Count a low note only where it is a real peak (louder than the semitones either side).
    const low = [];
    const notes = []; // per-note level (sqrt magnitude), indexed by MIDI number, for octave-specific checks
    for (let m = lowMidi - 1; m <= minMidi; m++) { low[m] = magOf(m); notes[m] = Math.sqrt(low[m]); }
    for (let m = lowMidi; m < minMidi; m++) {
      if (low[m] >= low[m - 1] && low[m] >= low[m + 1]) out[m % 12] += Math.sqrt(low[m]);
    }
    for (let m = minMidi; m <= maxMidi; m++) {
      if (midiFreq(m) > sr * 0.45) break;
      // compress so a few loud overtones don't dominate
      const v = Math.sqrt(m === minMidi ? low[m] : magOf(m));
      notes[m] = v;
      out[m % 12] += v;
    }
    const max = Math.max(...out) || 1;
    const result = out.map((v) => v / max);
    const nmax = Math.max(...notes.filter((x) => x !== undefined)) || 1;
    result.notes = notes.map((x) => (x === undefined ? 0 : x / nmax));
    return result;
  }

  /**
   * Compare a sound with the expected chord.
   * @param {number[]} profile  12-bin chroma (from chroma())
   * @param {number[]} chordPcs  pitch classes of the chord, root first (0 = C)
   * @returns {{status:'correct'|'wrong'|'not-a-chord', missing:number[], extra:number[], score:number}}
   */
  function evaluate(profile, chordPcs, { present = 0.36, extraMax = 0.62, overtoneExtraMax = 0.85 } = {}) {
    const pcs = chordPcs.map((p) => ((p % 12) + 12) % 12);
    const inChord = new Set(pcs);
    const sounding = profile.filter((v) => v >= 0.45).length;
    if (sounding < 2) return { status: 'not-a-chord', missing: [], extra: [], score: 0 };
    // The 5th is optional: the root's overtones contain it anyway, so it can't be reliably heard
    // as missing, and a chord without its 5th still sounds like that chord.
    const fifth = (pcs[0] + 7) % 12;
    const required = pcs.length >= 3 ? pcs.filter((pc) => pc !== fifth) : pcs;
    const missing = required.filter((pc) => profile[pc] < present);
    // Overtones add a little of other notes. A note a 5th above a loud chord tone is mostly that
    // tone's overtone, so it has to be much stronger before it counts as a wrong note.
    // (Only for the root and 3rd: a note a 5th above the chord's 5th is a 9th, a common mistake.)
    const overtoneOf = new Set(pcs.filter((pc) => pc !== fifth && profile[pc] >= 0.7).map((pc) => (pc + 7) % 12));
    const extra = profile
      .map((v, pc) => ({ pc, v }))
      .filter((x) => !inChord.has(x.pc) && x.v >= (overtoneOf.has(x.pc) ? overtoneExtraMax : extraMax))
      .map((x) => x.pc);
    const total = profile.reduce((a, b) => a + b, 0);
    const score = pcs.reduce((a, pc) => a + profile[pc], 0) / total;
    const ok = missing.length === 0 && extra.length === 0;
    return { status: ok ? 'correct' : 'wrong', missing, extra, score };
  }

  /** Predicted 12-bin profile of a chord shape, including each string's overtones. */
  function template(shape, tuning, { minMidi = 52 } = {}) {
    const out = new Array(12).fill(0);
    shape.forEach((f, s) => {
      if (f === null) return;
      const m = tuning[s] + f;
      for (let h = 1; h <= 10; h++) {
        const mh = m + Math.round(12 * Math.log2(h));
        if (mh < minMidi) continue;
        out[mh % 12] += Math.sqrt(1 / h);
      }
    });
    const max = Math.max(...out) || 1;
    return out.map((v) => v / max);
  }

  function cosine(a, b) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < 12; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return ab / Math.sqrt(aa * bb || 1);
  }

  const pcsOf = (shape, tuning) => new Set(shape.map((f, s) => (f === null ? null : (tuning[s] + f) % 12)).filter((x) => x !== null));
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  /**
   * Check a strum against the exact chord shape the player should be holding.
   * Compares the sound with the shape and with common mistakes (a string not ringing, a finger
   * one fret off, an open string that should be muted). Mistakes that don't change which notes
   * sound (e.g. muting a doubled note) are ignored.
   * @returns {{status:'correct'|'wrong'|'not-a-chord', mistake?:{s:number, kind:string, fret?:number}, fit:number}}
   */
  function checkShape(profile, shape, tuning, opts = {}) {
    const loud = profile.filter((v) => v >= 0.45).length;
    if (loud < 2) return { status: 'not-a-chord', fit: 0 };
    const wantPcs = pcsOf(shape, tuning);
    const fit = cosine(profile, template(shape, tuning));
    let best = null;
    // Octave-specific evidence: is the note this mistake would ADD really there, and is the
    // note it would REMOVE really missing? (Note profiles alone can't tell C#3 from C#4.)
    const level = (m) => (profile.notes && m !== null ? profile.notes[m] || 0 : 0);
    const consider = (variant, mistake) => {
      if (sameSet(pcsOf(variant, tuning), wantPcs)) return; // harmless
      const s = mistake.s;
      const added = variant[s] === null ? null : tuning[s] + variant[s];
      const removed = shape[s] === null ? null : tuning[s] + shape[s];
      const evidence = (added !== null ? level(added) : 0.3) - 0.5 * (removed !== null ? level(removed) : 0);
      const c = cosine(profile, template(variant, tuning)) + 0.5 * evidence;
      if (!best || c > best.score) best = { fit: cosine(profile, template(variant, tuning)), score: c, mistake };
    };
    shape.forEach((f, s) => {
      if (f === null) {
        const v = shape.slice(); v[s] = 0; consider(v, { s, kind: 'should-be-muted' });
        return;
      }
      const v = shape.slice(); v[s] = null; consider(v, { s, kind: 'not-ringing' });
      for (const d of [-1, 1, 2]) {
        const nf = f + d;
        if (nf < 0) continue;
        const w = shape.slice(); w[s] = nf; consider(w, { s, kind: 'wrong-fret', fret: nf });
      }
    });
    const minFit = opts.minFit ?? 0.88;
    if (fit >= minFit && (!best || fit >= best.fit)) return { status: 'correct', fit };
    return { status: 'wrong', fit, mistake: best ? best.mistake : null };
  }

  /**
   * Full check used by the app: is the chord right, and if not, what's the likely mistake?
   * @param {number[]} chordPcs  root first
   * @param {(number|null)[]|null} shape  the shape the player should hold (for the mistake hint)
   */
  function check(profile, chordPcs, shape, tuning) {
    const ev = evaluate(profile, chordPcs);
    if (ev.status !== 'wrong' || !shape) return ev;
    const sh = checkShape(profile, shape, tuning);
    return { ...ev, mistake: sh.mistake || null };
  }

  return { chroma, evaluate, template, checkShape, check };
});
