'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../src/renderer/pitch.js');
const NoteGate = require('../src/renderer/gate.js');

const SR = 48000;
const WINDOW = 2048; // analyser size used by the app
const HOP = 960; // app analyses every 20 ms
const ATTACK = 512; // newest samples used for pluck detection

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

/** Several plucks on one string: each new note stops the previous one. */
function phrase(notes, seconds, amp = 0.4) {
  const out = new Float32Array(Math.floor(SR * seconds));
  notes.forEach(([t0, freq], idx) => {
    const start = Math.floor(SR * t0);
    const stop = idx + 1 < notes.length ? Math.floor(SR * notes[idx + 1][0]) : out.length;
    const period = Math.round(SR / freq);
    const ring = Array.from({ length: period }, () => rand() * amp);
    for (let i = start, j = 0; i < stop; i++, j++) {
      const k = j % period;
      out[i] += ring[k];
      ring[k] = 0.996 * 0.5 * (ring[k] + ring[(k + 1) % period]);
    }
  });
  return out;
}

/** Time (s) at which each new note first appears. */
function timeline(audio) {
  const gate = new NoteGate({ threshold: 0.007 });
  const events = [];
  let last = null;
  for (let end = WINDOW; end <= audio.length; end += HOP) {
    const buf = audio.subarray(end - WINDOW, end);
    const level = Pitch.rms(buf);
    const { freq, clarity } = level >= 0.0035 ? Pitch.analyze(buf, SR, { minFreq: 66, maxFreq: 1400 }) : { freq: -1, clarity: 0 };
    const note = gate.push({ level, attackLevel: Pitch.rms(buf.subarray(WINDOW - ATTACK)), freq, clarity }, (end / SR) * 1000);
    const midi = note ? note.midi : null;
    if (midi !== null && midi !== last) events.push({ t: end / SR, midi });
    last = midi;
  }
  return events;
}

/** Run audio through the same pipeline the app uses; return the notes shown. */
function run(audio, guitarOnly = true) {
  const gate = new NoteGate({ guitarOnly, threshold: 0.007 });
  const rms = (buf) => Pitch.rms(buf);
  const shown = new Set();
  for (let end = WINDOW; end <= audio.length; end += HOP) {
    const buf = audio.subarray(end - WINDOW, end);
    const level = rms(buf);
    const { freq, clarity } = level >= 0.0035 ? Pitch.analyze(buf, SR, { minFreq: 66, maxFreq: 1400 }) : { freq: -1, clarity: 0 };
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

test('notes appear quickly (within 150 ms of the pluck)', () => {
  for (const freq of [82.41, 110, 196, 329.63]) {
    const [first] = timeline(pluck(freq, 1, 0.3));
    assert.ok(first, `no note for ${freq} Hz`);
    assert.ok(first.t - 0.3 <= 0.15, `${freq} Hz took ${((first.t - 0.3) * 1000).toFixed(0)} ms`);
  }
});

test('soft picking is detected', () => {
  assert.deepEqual(run(pluck(110, 1, 0.3, 0.03)), [45]);
});

test('fast runs: every note is shown, in order', () => {
  const run5 = [[0.3, 110], [0.45, 123.47], [0.6, 130.81], [0.75, 146.83], [0.9, 164.81]];
  assert.deepEqual(timeline(phrase(run5, 1.5)).map((e) => e.midi), [45, 47, 48, 50, 52]);
});

test('with the filter off, voices are picked up (filter is what blocks them)', () => {
  assert.ok(run(singing(220, 2), false).length > 0);
});
