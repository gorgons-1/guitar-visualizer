'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/renderer/chord.js');
const T = require('../src/renderer/theory.js');

const SR = 48000, N = 8192;
const std = T.TUNINGS.standard.notes;
const OPEN_B = [1.2e-4, 0.9e-4, 0.7e-4, 1.0e-4, 0.37e-4, 0.13e-4];
const X = null;
let seed = 9;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** ~170 ms of a strummed chord shape (low -> high, null = muted), 150 ms after the strum. */
function strum(shape) {
  const out = new Float32Array(N);
  shape.forEach((f, s) => {
    if (f === null) return;
    const f0 = T.midiToFreq(std[s] + f);
    const B = OPEN_B[s] * Math.pow(2, f / 6);
    const amp = 0.6 + 0.4 * Math.abs(rand());
    for (let k = 1; k <= 20; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > SR * 0.45) break;
      const a = amp * (0.7 / k) * (0.5 + 0.5 * Math.abs(rand()));
      const ph = rand() * Math.PI;
      for (let i = 0; i < N; i++) {
        const t = 0.15 + i / SR - s * 0.012;
        out[i] += a * Math.exp(-t * (1.2 + 0.7 * k)) * Math.sin(2 * Math.PI * fk * t + ph);
      }
    }
  });
  for (let i = 0; i < N; i++) out[i] = out[i] * 0.15 + 0.004 * rand();
  return out;
}
const judge = (played, root, chord, target) => C.check(C.chroma(strum(played), SR), T.chordPcs(root, chord), target, std);

test('common chords played correctly are marked correct', () => {
  for (const [label, shape, root, id] of [
    ['C', [X, 3, 2, 0, 1, 0], 0, 'maj'], ['G', [3, 2, 0, 0, 0, 3], 7, 'maj'], ['D', [X, X, 0, 2, 3, 2], 2, 'maj'],
    ['Am', [X, 0, 2, 2, 1, 0], 9, 'min'], ['Em', [0, 2, 2, 0, 0, 0], 4, 'min'], ['F barre', [1, 3, 3, 2, 1, 1], 5, 'maj'],
    ['G7', [3, 2, 0, 0, 0, 1], 7, '7'],
  ]) {
    assert.equal(judge(shape, root, id, shape).status, 'correct', label);
  }
});

test('wrong chords are caught, with a useful hint', () => {
  const Cshape = [X, 3, 2, 0, 1, 0];
  const am = judge([X, 0, 2, 2, 1, 0], 0, 'maj', Cshape); // Am instead of C
  assert.equal(am.status, 'wrong');
  const slip = judge([X, 3, 2, 0, 2, 0], 0, 'maj', Cshape); // B string on fret 2
  assert.equal(slip.status, 'wrong');
  assert.deepEqual(slip.mistake, { s: 4, kind: 'wrong-fret', fret: 2 });
  const Ashape = [X, 0, 2, 2, 1, 0];
  const muted = judge([X, 0, 2, 2, X, 0], 9, 'min', Ashape); // B string (the C, the 3rd) not ringing
  assert.equal(muted.status, 'wrong');
  assert.ok(muted.missing.includes(0), 'should say C is missing');
  const Dshape = [X, X, 0, 2, 3, 2];
  const ringing = judge([0, X, 0, 2, 3, 2], 2, 'maj', Dshape); // open low E ringing in D
  assert.equal(ringing.status, 'wrong');
  assert.equal(judge([0, 2, 2, 0, 0, 0], 7, 'maj', [3, 2, 0, 0, 0, 3]).status, 'wrong', 'Em instead of G');
});

test('a missing 5th or an extra chord tone is still correct', () => {
  assert.equal(judge([X, 3, 2, X, 1, 0], 0, 'maj', [X, 3, 2, 0, 1, 0]).status, 'correct', 'C without the G');
  assert.equal(judge([0, 3, 2, 0, 1, 0], 0, 'maj', [X, 3, 2, 0, 1, 0]).status, 'correct', 'C with low E (a chord tone)');
});

test('power chords: right shape is correct; a full chord or the wrong root is caught', () => {
  const P = [3, 5, 5, X, X, X];
  assert.equal(judge(P, 7, '5', P).status, 'correct', 'G5');
  assert.equal(judge([X, 3, 5, 5, X, X], 0, '5', [X, 3, 5, 5, X, X]).status, 'correct', 'C5');
  assert.equal(judge([5, 7, 7, X, X, X], 7, '5', P).status, 'wrong', 'A5 instead of G5');
  assert.equal(judge([3, 5, 5, 4, 3, 3], 7, '5', P).status, 'wrong', 'full G major instead of G5');
});
