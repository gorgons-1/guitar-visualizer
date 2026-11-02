'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../src/renderer/pitch.js');

const SR = 48000;

function guitarLike(freq, len = 4096) {
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Fundamental plus strong harmonics, like a real string.
    buf[i] = 0.4 * Math.sin(2 * Math.PI * freq * t)
      + 0.3 * Math.sin(2 * Math.PI * 2 * freq * t)
      + 0.2 * Math.sin(2 * Math.PI * 3 * freq * t)
      + 0.1 * Math.sin(2 * Math.PI * 4 * freq * t);
  }
  return buf;
}

for (const [label, freq] of [['low E2', 82.41], ['A2', 110], ['G3', 196], ['E4', 329.63], ['A5', 880], ['drop C', 65.41]]) {
  test(`detects ${label} (${freq} Hz)`, () => {
    const got = Pitch.detect(guitarLike(freq), SR, { minFreq: 50, maxFreq: 1400 });
    const cents = 1200 * Math.log2(got / freq);
    assert.ok(Math.abs(cents) < 5, `expected ${freq}, got ${got} (${cents.toFixed(1)} cents)`);
  });
}

test('returns -1 for noise', () => {
  const buf = new Float32Array(4096);
  let seed = 1;
  for (let i = 0; i < buf.length; i++) {
    seed = (seed * 16807) % 2147483647;
    buf[i] = (seed / 2147483647) * 2 - 1;
  }
  assert.equal(Pitch.detect(buf, SR), -1);
});

test('rms', () => {
  assert.equal(Pitch.rms(new Float32Array([1, -1, 1, -1])), 1);
});
