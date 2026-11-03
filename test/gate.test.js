'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../src/renderer/pitch.js');
const NoteGate = require('../src/renderer/gate.js');

const SR = 48000;
const WINDOW = 4096; // analyser size used by the app
const HOP = 2400; // app analyses every 50 ms
const ATTACK = 1024; // newest samples used for pluck detection

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// Plucked string (Karplus-Strong), like the real thing: sharp attack, steady pitch, decays.
function pluck(freq, seconds, startAt = 0.3, amp = 0.5) {
  const out = new Float32Array(Math.floor(SR * seconds));
  const start = Math.floor(SR * startAt);
  const period = Math.round(SR / freq);
  const ring = Array.from({ length: period }, () => rand() * amp);
  for (let i = start, j = 0; i < out.length; i++, j++) {
    const k = j % period;
    const next = 0.996 * 0.5 * (ring[k] + ring[(k + 1) % period]);
    out[i] = ring[k];
    ring[k] = next;
  }
  return out;
}

// Sung vowel: slow fade-in, vibrato, breathy noise.
function singing(freq, seconds) {
  const out = new Float32Array(Math.floor(SR * seconds));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.25) * 0.4;
    const f = freq * Math.pow(2, (45 * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
    phase += (2 * Math.PI * f) / SR;
    out[i] = env * (0.5 * Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.15 * Math.sin(5 * phase))
      + 0.04 * rand();
  }
  return out;
}

// Talking: pitch keeps sliding, syllables come and go, consonant noise.
function talking(seconds) {
  const out = new Float32Array(Math.floor(SR * seconds));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = 140 + 40 * Math.sin(2 * Math.PI * 1.3 * t) + 20 * Math.sin(2 * Math.PI * 3.1 * t);
    phase += (2 * Math.PI * f) / SR;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 1.5;
    out[i] = 0.4 * syllable * (0.5 * Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase))
      + 0.06 * syllable * rand();
  }
  return out;
}

const mix = (a, b) => a.map((x, i) => x + (b[i] || 0));

/** Run audio through the same pipeline the app uses; return the notes shown. */
function run(audio, guitarOnly = true) {
  const gate = new NoteGate({ guitarOnly, threshold: 0.007 });
  const rms = (buf) => Pitch.rms(buf);
  const shown = new Set();
  for (let end = WINDOW; end <= audio.length; end += HOP) {
    const buf = audio.subarray(end - WINDOW, end);
    const level = rms(buf);
    const { freq, clarity } = level >= 0.007 ? Pitch.analyze(buf, SR, { minFreq: 66, maxFreq: 1400 }) : { freq: -1, clarity: 0 };
    const note = gate.push({ level, attackLevel: rms(buf.subarray(WINDOW - ATTACK)), freq, clarity }, (end / SR) * 1000);
    if (note) shown.add(note.midi);
  }
  return [...shown];
}

test('plucked guitar notes are shown', () => {
  assert.deepEqual(run(pluck(82.41, 1.5)), [40], 'open low E');
  assert.deepEqual(run(pluck(196, 1.5)), [55], 'G string');
  assert.deepEqual(run(pluck(329.63, 1.5)), [64], 'open high E');
});

test('singing is ignored', () => {
  assert.deepEqual(run(singing(220, 2)), []);
  assert.deepEqual(run(singing(147, 2)), []);
});

test('talking is ignored', () => {
  assert.deepEqual(run(talking(3)), []);
});

test('guitar is still detected while someone talks', () => {
  const notes = run(mix(pluck(110, 2), talking(2).map((x) => x * 0.5)));
  assert.ok(notes.includes(45), `expected A2 (45), got ${notes}`);
});

test('with the filter off, voices are picked up (filter is what blocks them)', () => {
  assert.ok(run(singing(220, 2), false).length > 0);
});
