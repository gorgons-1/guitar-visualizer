'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Tab = require('../src/renderer/tab.js');
const T = require('../src/renderer/theory.js');

const simple = `
Intro (play twice)
e|-------0---|---------|
B|-----1-----|-----3---|
G|---2-------|---0-----|
D|-2---------|-0-------|
A|-0---------|---------|
E|-----------|---------|
`;

test('reads single notes and chords, low string = 0', () => {
  const song = Tab.parse(simple);
  assert.equal(song.strings, 6);
  assert.equal(song.events.length, 7);
  assert.deepEqual(song.events[0].notes.map((n) => [n.s, n.f]), [[1, 0], [2, 2]]); // A open + D fret 2 together
  assert.deepEqual(song.events[1].notes.map((n) => [n.s, n.f]), [[3, 2]]);
  assert.deepEqual(song.events[3].notes.map((n) => [n.s, n.f]), [[5, 0]]); // high e open
  assert.equal(song.events[0].bar, 0);
  assert.equal(song.events[3].bar, 0);
  assert.equal(song.events[4].bar, 1, 'bar line counted');
  assert.deepEqual(song.events[6].notes.map((n) => [n.s, n.f]), [[4, 3]]);
  assert.equal(song.events[0].gap, 2);
});

test('two-digit frets, techniques and bends', () => {
  const song = Tab.parse(`
e|-12-10----------|
B|-----------------|
G|-------5h7p5-----|
D|-------------7b9r7|
A|------------------|
E|------------------|`);
  const ev = song.events.map((e) => e.notes.map((n) => `${n.s}:${n.f}:${n.pitch}:${n.tech}`).join(' '));
  assert.deepEqual(ev, ['5:12:12:', '5:10:10:', '3:5:5:', '3:7:7:hammer-on', '3:5:5:pull-off', '2:7:7:', '2:7:9:bend', '2:7:7:release']);
});

test('a 2-digit fret and a 1-digit fret written slightly off are one chord', () => {
  const song = Tab.parse(`
e|--10---|
B|---8---|
G|--9----|
D|-------|
A|-------|
E|-------|`);
  assert.equal(song.events.length, 1);
  assert.deepEqual(song.events[0].notes.map((n) => [n.s, n.f]), [[3, 9], [4, 8], [5, 10]]);
});

test('text, chord names and lyrics between blocks are ignored; blocks join up', () => {
  const song = Tab.parse(`Song title
Tuning: Drop D
   Am        C
D|-------0---|
A|-----1-----|
F|---2-------|
D|-2---------|
A|-0---------|
D|-0---------|

la la la

D|-3-|
A|---|
F|---|
D|---|
A|---|
D|---|`);
  assert.equal(song.events.length, 5);
  assert.equal(song.events[4].sys, 1);
  assert.equal(song.events[4].notes[0].s, 5);
  assert.equal(song.events[4].bar, 1);
  // labels D A F D A D are not a known tuning; "e B G D A D" would be Drop D:
  const dropD = Tab.parse(simple.replace('E|', 'D|'));
  assert.equal(Tab.matchTuning(dropD, T.TUNINGS, 'standard'), 'dropD');
  assert.equal(Tab.matchTuning(Tab.parse(simple), T.TUNINGS, 'dropD'), 'standard');
});

test('bass tab (4 lines) and no labels', () => {
  const song = Tab.parse(`
|---------|
|-----2---|
|---3-----|
|-0-------|`);
  assert.equal(song.strings, 4);
  assert.equal(Tab.matchTuning(song, T.TUNINGS, 'standard'), 'bass4');
  assert.deepEqual(song.events.map((e) => [e.notes[0].s, e.notes[0].f]), [[0, 0], [1, 3], [2, 2]]);
});

test('no tab gives a helpful warning', () => {
  const song = Tab.parse('just some words\nand more');
  assert.equal(song.events.length, 0);
  assert.match(song.warnings[0], /No tab found/);
});
