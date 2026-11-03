'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/renderer/theory.js');

const std = T.TUNINGS.standard.notes;
const C = 0, E = 4, G = 7, A = 9, D = 2, F = 5;
const has = (list, shape) => list.some((v) => T.formatVoicing(v) === shape);

test('scale pitch classes', () => {
  assert.deepEqual(T.scalePcs(A, 'minorPentatonic'), [9, 0, 2, 4, 7]);
  assert.deepEqual(T.scalePcs(C, 'major'), [0, 2, 4, 5, 7, 9, 11]);
});

test('chord pitch classes', () => {
  assert.deepEqual(T.chordPcs(C, 'maj'), [0, 4, 7]);
  assert.deepEqual(T.chordPcs(A, 'm7'), [9, 0, 4, 7]);
});

test('note names and frequencies', () => {
  assert.equal(T.noteName(10, false), 'A#');
  assert.equal(T.noteName(10, true), 'Bb');
  assert.equal(T.noteNameWithOctave(40), 'E2');
  assert.equal(T.midiToFreq(69), 440);
  assert.ok(Math.abs(T.freqToMidi(82.41) - 40) < 0.01);
});

test('finds the common open chord shapes', () => {
  assert.ok(has(T.findVoicings(std, C, 'maj'), 'x 3 2 0 1 0'), 'C');
  assert.ok(has(T.findVoicings(std, G, 'maj'), '3 2 0 0 0 3'), 'G');
  assert.ok(has(T.findVoicings(std, E, 'maj'), '0 2 2 1 0 0'), 'E');
  assert.ok(has(T.findVoicings(std, A, 'min'), 'x 0 2 2 1 0'), 'Am');
  assert.ok(has(T.findVoicings(std, D, 'maj'), 'x x 0 2 3 2'), 'D');
});

test('finds barre chords', () => {
  assert.ok(has(T.findVoicings(std, F, 'maj'), '1 3 3 2 1 1'), 'F barre');
});

test('every voicing has the root in the bass and only chord tones', () => {
  for (const [id] of Object.entries(T.CHORDS)) {
    const pcs = new Set(T.chordPcs(D, id));
    for (const v of T.findVoicings(std, D, id)) {
      const sounding = v.map((f, s) => (f === null ? null : std[s] + f)).filter((m) => m !== null);
      assert.equal(T.pc(sounding[0]), D, `${id} ${T.formatVoicing(v)}`);
      sounding.forEach((m) => assert.ok(pcs.has(T.pc(m))));
    }
  }
});

test('works for 7-string and bass tunings', () => {
  assert.ok(T.findVoicings(T.TUNINGS.sevenString.notes, E, 'min').length > 0);
  assert.ok(T.findVoicings(T.TUNINGS.bass4.notes, G, 'maj').length > 0);
});

test('scale run goes up an octave and back', () => {
  const run = T.buildRun(std, A, T.scalePcs(A, 'minorPentatonic'), 1);
  assert.deepEqual(run, [45, 48, 50, 52, 55, 57, 55, 52, 50, 48, 45]);
});

test('guessing the fret for a played note', () => {
  const pos = (midi, hand) => T.guessPosition(std, 15, midi, hand);
  const E4 = 64;
  // no idea where the hand is -> open string
  assert.deepEqual(pos(E4, null), { s: 5, f: 0 });
  // hand around 5th fret on the A string -> still the open high E
  assert.deepEqual(pos(E4, { s: 1, f: 5 }), { s: 5, f: 0 });
  // hand on the B string at fret 5, playing there -> B string 5th fret
  assert.deepEqual(pos(E4, { s: 4, f: 5 }), { s: 4, f: 5 });
  // hand up at 9th fret on the G string -> G string 9th fret
  assert.deepEqual(pos(E4, { s: 3, f: 9 }), { s: 3, f: 9 });
  // A3 with hand at D string 7th fret -> D7, not A12 or G2
  assert.deepEqual(pos(57, { s: 2, f: 7 }), { s: 2, f: 7 });
  // B3: open B unless the hand is right there on the G string 4th fret
  assert.deepEqual(pos(59, null), { s: 4, f: 0 });
  assert.deepEqual(pos(59, { s: 3, f: 4 }), { s: 3, f: 4 });
  // only one place for the open low E
  assert.deepEqual(pos(40, { s: 3, f: 9 }), { s: 0, f: 0 });
});
