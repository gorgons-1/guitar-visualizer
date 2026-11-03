'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Timbre = require('../src/renderer/timbre.js');
const T = require('../src/renderer/theory.js');

const SR = 48000;
const std = T.TUNINGS.standard.notes;
// Plausible open-string inharmonicity, low E .. high E (plain G stiffer than wound D, as on real guitars).
const OPEN_B = [1.2e-4, 0.9e-4, 0.7e-4, 1.0e-4, 0.37e-4, 0.13e-4];

let seed = 5;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** ~170 ms of a stiff string, taken 120 ms after the pluck. */
function stiffString(f0, B, noise = 0.005) {
  const n = 8192;
  const out = new Float32Array(n);
  const amps = Array.from({ length: 24 }, (_, k) => (0.7 / (k + 1)) * (0.6 + 0.4 * Math.abs(rand())));
  const ph = amps.map(() => rand() * Math.PI);
  for (let i = 0; i < n; i++) {
    const t = 0.12 + i / SR;
    let v = noise * rand();
    for (let k = 0; k < 24; k++) {
      const m = k + 1, fm = m * f0 * Math.sqrt(1 + B * m * m);
      if (fm > SR * 0.45) break;
      v += amps[k] * Math.exp(-t * (1 + 0.8 * m)) * Math.sin(2 * Math.PI * fm * t + ph[k]);
    }
    out[i] = v * 0.3;
  }
  return out;
}

test('measures inharmonicity of each open string within 10%', () => {
  std.forEach((midi, s) => {
    const f0 = T.midiToFreq(midi);
    const r = Timbre.measure(stiffString(f0, OPEN_B[s]), SR, f0);
    assert.ok(r, `string ${s}: no measurement`);
    assert.ok(Math.abs(r.B / OPEN_B[s] - 1) < 0.1, `string ${s}: B ${r.B} vs ${OPEN_B[s]}`);
  });
});

test('pure (non-stiff) tone gives no usable measurement or ~0 B', () => {
  const f0 = 196;
  const r = Timbre.measure(stiffString(f0, 0), SR, f0);
  assert.ok(!r || r.B < 1e-5);
});

test('identifies the string for the same E played in three places', () => {
  const E4 = 64;
  const cands = T.positionsOf(std, 15, E4); // open e, B5, G9, D14
  for (const [s, f] of [[5, 0], [4, 5], [3, 9]]) {
    const B = OPEN_B[s] * Math.pow(2, f / 6);
    const r = Timbre.measure(stiffString(T.midiToFreq(E4), B), SR, T.midiToFreq(E4));
    const c = Timbre.classify(cands, r.B, OPEN_B);
    assert.deepEqual(c.best, { s, f }, `played string ${s} fret ${f}, got ${JSON.stringify(c.best)}`);
    // G9 vs D14 are genuinely similar on this guitar (stiffness within 25%), so only require
    // confidence where the candidate strings clearly differ.
    if (s !== 3) assert.ok(c.confidence > 0.6, `low confidence ${c.confidence} for string ${s} fret ${f}`);
  }
});

test('string detection accuracy over the neck (frets 0-12) is at least 85%', () => {
  let total = 0, right = 0;
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= 12; f += 3) {
      const midi = std[s] + f;
      const cands = T.positionsOf(std, 15, midi);
      if (cands.length < 2) continue;
      const B = OPEN_B[s] * Math.pow(2, f / 6) * (1 + 0.15 * rand()); // real strings vary a bit
      const r = Timbre.measure(stiffString(T.midiToFreq(midi), B), SR, T.midiToFreq(midi));
      total++;
      if (r) {
        const c = Timbre.classify(cands, r.B, OPEN_B);
        if (c.best.s === s && c.best.f === f) right++;
      }
    }
  }
  assert.ok(right / total >= 0.85, `${right}/${total}`);
});
