(() => {
  'use strict';
  const T = window.Theory;
  const { Synth, LiveInput } = window.GVAudio;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------- State ----------------
  const DEFAULTS = {
    mode: 'scale', root: 9, scale: 'minorPentatonic', chord: 'maj', tuning: 'standard',
    frets: 15, labels: 'notes', flats: false, lefty: false, flip: false, tempo: 120,
    device: '', channel: 'mix', monitor: false, sensitivity: 60, showAllLive: false, guitarOnly: true, handLock: '',
    practiceType: 'find', checkChord: false, tabSpeed: 100, tabLoop: false, section: 'home', scalePos: 'all', cofKey: null, countIn: true, alongSound: false,
  };
  const state = (() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('gv-state') || '{}') }; } catch { return { ...DEFAULTS }; }
  })();
  if (!T.TUNINGS[state.tuning]) state.tuning = DEFAULTS.tuning;
  if (!T.SCALES[state.scale]) state.scale = DEFAULTS.scale;
  if (!T.CHORDS[state.chord]) state.chord = DEFAULTS.chord;
  if (state.practiceType === 'run') state.practiceType = 'lesson';
  const save = () => { try { localStorage.setItem('gv-state', JSON.stringify(state)); } catch { /* ignore */ } };

  let voicingIndex = 0;
  let voicingCache = { key: '', list: [] };
  let liveMidi = null;
  let livePos = null; // best-guess {s, f} for the note being played
  let handPos = null; // last FRETTED position; used to guess where the hand is
  let handTime = 0; // when a note was last heard (hand position is forgotten after a pause)
  let playingMarks = []; // [{s, f}] highlighted during playback

  const synth = new Synth();
  const input = new LiveInput(() => synth.context());

  // ---------------- Helpers ----------------
  const tuning = () => T.TUNINGS[state.tuning].notes;
  const name = (p) => T.noteName(p, state.flats);
  /** A note's name as written in the current scale (A Phrygian has Bb, not A#), else its plain name. */
  const noteLabel = (p) => (state.mode === 'scale' ? T.spellScale(state.root, state.scale, state.flats)[T.pc(p)] || name(p) : name(p));
  const activePcs = () => (state.mode === 'scale' ? T.scalePcs(state.root, state.scale) : T.chordPcs(state.root, state.chord));

  function colorFor(semis) {
    switch (semis) {
      case 0: return 'var(--root)';
      case 3: case 4: return 'var(--third)';
      case 6: case 7: case 8: return 'var(--fifth)';
      case 10: case 11: return 'var(--seventh)';
      default: return 'var(--other)';
    }
  }

  function voicings() {
    const key = [state.tuning, state.root, state.chord, state.frets].join('|');
    if (voicingCache.key !== key) {
      // the main shapes first (as in the diagrams), then every other way to play it
      const main = shapes().map((sh) => sh.v);
      const rest = T.findVoicings(tuning(), state.root, state.chord, { maxFret: state.frets })
        .filter((v) => !main.some((m) => sameShape(m, v)));
      voicingCache = { key, list: main.concat(rest) };
      voicingIndex = 0;
    }
    return voicingCache.list;
  }
  const currentVoicing = () => voicings()[voicingIndex] || null;

  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function fillSelect(select, entries, value) {
    select.innerHTML = '';
    for (const [val, label] of entries) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      select.appendChild(o);
    }
    select.value = String(value);
  }

  // ---------------- Fretboard drawing ----------------
  const svg = $('fretboard');
  let geom = null;
  let liveLayer = null;

  function drawBoard() {
    const tun = tuning();
    const n = tun.length;
    const N = state.frets;
    const W = 1200, gap = 34, top = 26;
    const H = top * 2 + gap * (n - 1) + 26;
    const openX = 26, nutX = 56, endX = W - 14;
    const k = 1 - Math.pow(2, -N / 12);
    const fx = (f) => nutX + ((endX - nutX) * (1 - Math.pow(2, -f / 12))) / k;
    const X = (x) => (state.lefty ? W - x : x);
    const sy = (s) => top + (state.flip ? s : n - 1 - s) * gap; // high string on top (flipped: low string on top)
    const noteX = (f) => (f === 0 ? openX : (fx(f - 1) + fx(f)) / 2);
    geom = { X, sy, noteX };

    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const boardTop = Math.min(sy(0), sy(n - 1)) - 14, boardBot = Math.max(sy(0), sy(n - 1)) + 14;
    const rect = (x1, x2, y, h, cls) =>
      el('rect', { x: Math.min(X(x1), X(x2)), y, width: Math.abs(X(x2) - X(x1)), height: h, class: cls }, svg);

    rect(nutX, endX, boardTop, boardBot - boardTop, 'board');

    // Inlays
    const midY = (boardTop + boardBot) / 2;
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      if (f > N) continue;
      const cx = X(noteX(f));
      if (f % 12 === 0) {
        el('circle', { cx, cy: midY - gap, r: 7, class: 'inlay' }, svg);
        el('circle', { cx, cy: midY + gap, r: 7, class: 'inlay' }, svg);
      } else {
        el('circle', { cx, cy: midY, r: 7, class: 'inlay' }, svg);
      }
    }

    // Frets and nut
    for (let f = 1; f <= N; f++) el('line', { x1: X(fx(f)), x2: X(fx(f)), y1: boardTop, y2: boardBot, class: 'fretline' }, svg);
    el('line', { x1: X(nutX), x2: X(nutX), y1: boardTop - 1, y2: boardBot + 1, class: 'nut' }, svg);

    // Strings (thicker for lower strings)
    for (let s = 0; s < n; s++) {
      const w = 1 + ((n - 1 - s) / Math.max(1, n - 1)) * 2.2;
      el('line', { x1: X(openX - 12), x2: X(endX), y1: sy(s), y2: sy(s), class: 'string', 'stroke-width': w }, svg);
    }

    // Fret numbers
    for (let f = 0; f <= N; f++) {
      const marker = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(f);
      const t = el('text', { x: X(noteX(f)), y: boardBot + 19, class: 'fretnum' + (marker ? ' marker' : '') }, svg);
      t.textContent = f;
    }

    // Locked hand-position area
    const range = areaRange();
    if (range) {
      const lo = range[0], hi = Math.min(N, range[1]);
      const x1 = lo === 0 ? openX - 16 : fx(lo - 1), x2 = fx(hi);
      rect(x1, x2, boardTop - 6, boardBot - boardTop + 12, 'hand-area');
    }

    // Notes
    const pcs = activePcs();
    const pcSet = new Set(pcs);
    const voicing = state.mode === 'chord' ? currentVoicing() : null;
    const practiceOnly = practiceArea();
    const box = scaleBoxNow();
    const boxOnly = box ? new Set(box.notes.map((p) => p.s + ':' + p.f)) : null;
    // which finger plays each note of the chord shape (and a barre, if it needs one)
    const fing = voicing && !practice.on && !tabView() ? T.fingering(voicing) : null;
    if (fing && fing.barre) {
      const bx = X(noteX(fing.barre.fret));
      const y1 = sy(fing.barre.to), y2 = sy(fing.barre.from);
      el('rect', { x: bx - 9, y: Math.min(y1, y2) - 9, width: 18, height: Math.abs(y2 - y1) + 18, rx: 9, class: 'barre' }, svg);
    }

    for (let s = 0; s < n; s++) {
      if (voicing && voicing[s] === null && !tabView()) {
        const t = el('text', { x: X(openX), y: sy(s), class: 'mute' }, svg);
        t.textContent = '×';
      }
      for (let f = 0; f <= N; f++) {
        const midi = tun[s] + f;
        const p = T.pc(midi);
        const cx = X(noteX(f)), cy = sy(s);

        const hit = el('circle', { cx, cy, r: 14, class: 'hit' }, svg);
        hit.addEventListener('mousedown', () => playNote(midi, { s, f }));
        el('title', {}, hit).textContent = T.noteNameWithOctave(midi, state.flats);

        if (tabView() || !pcSet.has(p)) continue;
        if (practiceOnly && !practiceOnly.has(s + ':' + f)) continue; // practising: only this area's notes
        if (!practiceOnly && boxOnly && !boxOnly.has(s + ':' + f)) continue; // one scale position picked
        if (voicing && voicing[s] === null && f === 0) continue; // keep the × readable
        // Chord mode: only the shape being shown (other places for the chord's notes are hidden)
        if (voicing && voicing[s] !== f && !practice.on) continue;
        const ghost = state.mode === 'chord' && !voicing;
        const semis = T.pc(p - state.root);
        el('circle', { cx, cy, r: 12, class: 'dot' + (ghost ? ' ghost' : ''), fill: colorFor(semis) }, svg);
        if (!ghost && state.labels !== 'none') {
          const t = el('text', { x: cx, y: cy, class: 'dot-label' }, svg);
          t.textContent = state.labels === 'intervals' ? T.INTERVALS[semis] : noteLabel(p);
        }
        if (fing && fing.fingers[s] && voicing[s] === f) {
          const bx = cx + (state.lefty ? -15 : 15), by = cy - 12;
          el('circle', { cx: bx, cy: by, r: 8, class: 'finger' }, svg);
          const t = el('text', { x: bx, y: by, class: 'finger-num' }, svg);
          t.textContent = fing.fingers[s];
        }
      }
    }

    liveLayer = el('g', {}, svg);
    drawOverlay();
  }

  function drawOverlay() {
    if (!liveLayer || !geom) return;
    liveLayer.innerHTML = '';
    const mark = (p, cls) =>
      el('circle', { cx: geom.X(geom.noteX(p.f)), cy: geom.sy(p.s), r: 15, class: 'ring ' + cls }, liveLayer);
    playingMarks.forEach((p) => mark(p, 'playing'));
    const showTab = tabView();
    if (showTab) drawTabOverlay(mark);
    const target = practice.on && !showTab ? practice.target : null;
    if (practice.on && !showTab && state.practiceType === 'lesson') {
      // the next few notes of the lesson, numbered
      practice.order.slice(practice.idx + 1, practice.idx + 4).forEach((p, i) => {
        if (target && p.s === target.s && p.f === target.f) return;
        mark(p, 'next next' + (i + 1));
        const t = el('text', { x: geom.X(geom.noteX(p.f)) + 13, y: geom.sy(p.s) - 12, class: 'next-num' }, liveLayer);
        t.textContent = i + 2;
      });
    }
    if (target) {
      mark(target, 'target');
      if (practice.on && state.practiceType === 'lesson') {
        const t = el('text', { x: geom.X(geom.noteX(target.f)) + 13, y: geom.sy(target.s) - 12, class: 'next-num now' }, liveLayer);
        t.textContent = 1;
      }
    }
  }

  const positionsOf = (midi) => T.positionsOf(tuning(), state.frets, midi);
  const handLock = () => null; // the neck no longer shows where a played note is, so there's no hand position to lock
  const bestPosition = (midi, hand) => T.guessPosition(tuning(), state.frets, midi, hand, handLock());


  // ---------------- Chord shapes (diagrams) ----------------
  let shapeCache = { key: '', list: [] };
  function shapes() {
    const key = [state.tuning, state.root, state.chord, state.frets].join('|');
    if (shapeCache.key !== key) shapeCache = { key, list: T.chordShapes(tuning(), state.root, state.chord, state.frets) };
    return shapeCache.list;
  }
  const sameShape = (a, b) => !!a && !!b && a.length === b.length && a.every((f, i) => f === b[i]);

  /** Small chord box diagram (strings up and down, low string on the left). */
  function chordDiagram(v) {
    const tun = tuning(), n = tun.length;
    const fr = v.filter((f) => f !== null && f > 0);
    const hi = fr.length ? Math.max(...fr) : 0, lo = fr.length ? Math.min(...fr) : 0;
    const base = hi <= 4 ? 1 : lo; // show the nut when the shape fits in the first frets
    const rows = Math.max(4, hi - base + 1);
    const gx = 15, gy = 18, left = 24, top = 22;
    const W = left + gx * (n - 1) + 12, H = top + gy * rows + 6;
    const svgEl = document.createElementNS(SVGNS, 'svg');
    svgEl.setAttribute('width', W);
    svgEl.setAttribute('height', H);
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const sx = (s) => left + gx * (state.lefty ? n - 1 - s : s);
    for (let r = 0; r <= rows; r++) {
      el('line', { x1: sx(0), x2: sx(n - 1), y1: top + r * gy, y2: top + r * gy, class: r === 0 && base === 1 ? 'cd-nut' : 'cd-fret' }, svgEl);
    }
    for (let s = 0; s < n; s++) el('line', { x1: sx(s), x2: sx(s), y1: top, y2: top + rows * gy, class: 'cd-string' }, svgEl);
    if (base > 1) {
      const t = el('text', { x: Math.min(sx(0), sx(n - 1)) - 6, y: top + gy / 2, class: 'cd-base' }, svgEl);
      t.textContent = base + 'fr';
    }
    const fing = T.fingering(v);
    if (fing && fing.barre) {
      const y = top + (fing.barre.fret - base + 0.5) * gy;
      const xa = sx(fing.barre.from), xb = sx(fing.barre.to);
      el('rect', { x: Math.min(xa, xb) - 6.5, y: y - 6.5, width: Math.abs(xb - xa) + 13, height: 13, rx: 6.5, class: 'cd-barre' }, svgEl);
    }
    v.forEach((f, s) => {
      if (f === null || f === 0) {
        const t = el('text', { x: sx(s), y: top - 9, class: 'cd-mark' }, svgEl);
        t.textContent = f === null ? '×' : '○';
        return;
      }
      const semis = T.pc(tun[s] + f - state.root);
      const cy = top + (f - base + 0.5) * gy;
      el('circle', { cx: sx(s), cy, r: 6.5, class: 'cd-dot', fill: colorFor(semis) }, svgEl);
      if (fing && fing.fingers[s]) {
        const t = el('text', { x: sx(s), y: cy, class: 'cd-finger' }, svgEl);
        t.textContent = fing.fingers[s];
      }
    });
    return svgEl;
  }

  function renderShapes() {
    const card = $('shapes-card');
    card.classList.toggle('hidden', state.mode !== 'chord');
    if (state.mode !== 'chord') return;
    const power = state.chord === '5';
    const c = T.CHORDS[state.chord];
    $('shapes-title').textContent = `${name(state.root)}${c.symbol} shapes up the neck`;
    $('power-btn').classList.toggle('on', power);
    $('power-btn').textContent = power ? '⚡ Power chords (on)' : '⚡ Power chords';
    $('shapes-hint').textContent = power
      ? 'Power chords are just the root, the 5th and the octave, so they work with any key or style - the sound of rock and metal. Same shape anywhere on the neck: move it to change the chord. Mute the strings you don\'t play.'
      : 'The main ways to play this chord, from the nut up the neck. Click one to see it on the neck and hear it.';
    $('shapes-hint').textContent += ' Small numbers are fingers: 1 index, 2 middle, 3 ring, 4 little. A long bar means a barre (lay finger 1 flat across those strings).';
    const box = $('shapes');
    box.innerHTML = '';
    const list = shapes();
    if (!list.length) { box.textContent = 'No shapes found for this chord in this tuning.'; return; }
    const cur = currentVoicing();
    list.forEach((sh, i) => {
      const b = document.createElement('div');
      b.className = 'shape' + (sameShape(sh.v, cur) ? ' sel' : '');
      b.title = T.formatVoicing(sh.v) + ' (low → high string)';
      const head = document.createElement('b');
      head.textContent = `${i + 1}. ${sh.label}`;
      b.appendChild(head);
      b.appendChild(chordDiagram(sh.v));
      const sub = document.createElement('span');
      sub.textContent = T.formatVoicing(sh.v);
      b.appendChild(sub);
      b.onclick = () => selectShape(sh.v);
      box.appendChild(b);
    });
  }

  /** Put a shape on the neck (as the current voicing) and strum it. */
  function selectShape(v) {
    const list = voicings();
    let idx = list.findIndex((x) => sameShape(x, v));
    if (idx < 0) { list.push(v); idx = list.length - 1; }
    voicingIndex = idx;
    render();
    playCurrent();
    if (state.checkChord) {
      $('chord-feedback').textContent = `Now strum shape: ${T.formatVoicing(v)}…`;
      $('chord-feedback').className = 'chord-feedback';
    }
  }


  // ---------------- Circle of fifths ----------------
  /** The key the circle shows: the scale on the neck if it's major/minor, else the last key picked. */
  function currentKey() {
    if (state.mode === 'scale') return { pc: state.root, minor: T.scalePcs(0, state.scale).includes(3) }; // has a minor 3rd: minor key
    if (state.cofKey) return state.cofKey;
    return { pc: state.root, minor: state.mode !== 'scale' && T.CHORDS[state.chord].intervals[1] === 3 };
  }
  const keyName = (k) => T.noteName(k.pc, T.keyUsesFlats(k.pc, k.minor)) + (k.minor ? ' minor' : ' major');

  function polar(r, deg) {
    const a = (deg * Math.PI) / 180;
    return [200 + r * Math.cos(a), 200 + r * Math.sin(a)];
  }
  function wedge(r1, r2, a1, a2) {
    const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2), [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
    return `M${x1},${y1} A${r2},${r2} 0 0 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 0 0 ${x4},${y4} Z`;
  }

  function pickKey(pcKey, minor) {
    state.cofKey = { pc: pcKey, minor };
    state.mode = 'scale';
    state.root = pcKey;
    state.scale = minor ? 'minor' : 'major';
    state.flats = T.keyUsesFlats(pcKey, minor);
    $('mode').value = 'scale';
    $('scale').value = state.scale;
    $('flats').checked = state.flats;
    fillRootSelect();
    render();
  }

  function pickChord(c) {
    state.cofKey = currentKey();
    state.mode = 'chord';
    state.root = c.rootPc;
    state.chord = c.chord;
    $('mode').value = 'chord';
    $('chord').value = c.chord;
    fillRootSelect();
    render();
    playCurrent();
  }

  function renderCircle() {
    const key = currentKey();
    const idx = T.circleIndex(key.pc, key.minor);
    const svgC = $('circle');
    svgC.innerHTML = '';
    const near = new Set([(idx + 11) % 12, idx, (idx + 1) % 12]);
    T.CIRCLE.forEach((k, i) => {
      const mid = i * 30 - 90, a1 = mid - 15, a2 = mid + 15;
      const minorPc = T.pc(k.pc + 9);
      // outer ring: major key
      const majSel = !key.minor && i === idx, minSel = key.minor && i === idx;
      let cls = 'cof-cell' + (majSel ? ' sel' : key.minor && i === idx ? ' rel' : near.has(i) ? ' inkey' : '');
      const outer = el('path', { d: wedge(132, 196, a1, a2), class: cls }, svgC);
      outer.addEventListener('click', () => pickKey(k.pc, false));
      el('title', {}, outer).textContent = `${k.major} major - ${k.sig === 0 ? 'no sharps or flats' : Math.abs(k.sig) + (k.sig > 0 ? ' sharp' : ' flat') + (Math.abs(k.sig) > 1 ? 's' : '')}`;
      let [x, y] = polar(168, mid);
      let t = el('text', { x, y, class: 'cof-major' + (majSel ? ' cof-sel-text' : '') }, svgC);
      t.textContent = k.major.replace('/', ' ').split(' ')[0];
      [x, y] = polar(146, mid);
      t = el('text', { x, y, class: 'cof-sig' + (majSel ? ' cof-sel-text' : '') }, svgC);
      t.textContent = k.sig === 0 ? '' : Math.abs(k.sig) + (k.sig > 0 ? '♯' : '♭');
      // inner ring: relative minor
      cls = 'cof-cell' + (minSel ? ' sel' : !key.minor && i === idx ? ' rel' : near.has(i) ? ' inkey' : '');
      const inner = el('path', { d: wedge(84, 132, a1, a2), class: cls }, svgC);
      inner.addEventListener('click', () => pickKey(minorPc, true));
      el('title', {}, inner).textContent = `${k.minor.split('/')[0]} - relative minor of ${k.major.split('/')[0]}`;
      [x, y] = polar(108, mid);
      t = el('text', { x, y, class: 'cof-minor' + (minSel ? ' cof-sel-text' : '') }, svgC);
      t.textContent = k.minor.split('/')[0];
    });
    el('circle', { cx: 200, cy: 200, r: 80, class: 'cof-center' }, svgC);
    let t = el('text', { x: 200, y: 188, class: 'cof-center-text' }, svgC);
    t.textContent = keyName(key);
    const sig = T.keySignature(key.pc, key.minor);
    t = el('text', { x: 200, y: 214, class: 'cof-center-sub' }, svgC);
    t.textContent = sig.count === 0 ? 'no ♯ or ♭' : `${Math.abs(sig.count)} ${sig.count > 0 ? 'sharp' : 'flat'}${Math.abs(sig.count) > 1 ? 's' : ''}`;

    // info panel
    const useFlats = T.keyUsesFlats(key.pc, key.minor);
    const nm = (p) => T.noteName(p, useFlats);
    $('key-title').textContent = `Key of ${keyName(key)}`;
    $('key-sig').textContent = sig.count === 0 ? 'No sharps or flats' : `${Math.abs(sig.count)} ${sig.count > 0 ? 'sharp' : 'flat'}${Math.abs(sig.count) > 1 ? 's' : ''}: ${sig.notes.join(' ')}`;
    const rel = key.minor ? { pc: T.pc(key.pc + 3), minor: false } : { pc: T.pc(key.pc + 9), minor: true };
    const iv = T.CIRCLE[(idx + 11) % 12], v = T.CIRCLE[(idx + 1) % 12];
    const neigh = (k) => (key.minor ? k.minor : k.major).split('/')[0];
    $('key-rel').textContent = `Relative ${rel.minor ? 'minor' : 'major'}: ${keyName(rel)} · Next door on the circle: ${neigh(iv)} (${key.minor ? 'iv' : 'IV'}) and ${neigh(v)} (${key.minor ? 'v' : 'V'})`;
    const box = $('key-chords');
    box.innerHTML = '';
    T.diatonicChords(key.pc, key.minor).forEach((c) => {
      const b = document.createElement('button');
      const on = state.mode === 'chord' && state.root === c.rootPc && state.chord === c.chord;
      b.className = 'key-chord' + (on ? ' on' : '');
      b.innerHTML = `<b>${nm(c.rootPc)}${T.CHORDS[c.chord].symbol}</b><small>${c.roman}</small>`;
      b.title = `${nm(c.rootPc)} ${T.CHORDS[c.chord].name.toLowerCase()} - click to see the shapes`;
      b.onclick = () => pickChord(c);
      box.appendChild(b);
    });
  }

  /** Strum I - IV - V - I in the current key, using the easiest shape of each chord. */
  function playProgression() {
    clearPlayback();
    const key = currentKey();
    const ch = T.diatonicChords(key.pc, key.minor);
    const seq = [ch[0], ch[3], ch[4], ch[0]];
    const beat = (60 / state.tempo) * 2;
    seq.forEach((c, i) => {
      const sh = T.chordShapes(tuning(), c.rootPc, c.chord, state.frets)[0];
      if (!sh) return;
      const marks = sh.v.map((f, s) => (f === null ? null : { s, f })).filter(Boolean);
      marks.forEach((p, k) => synth.play(tuning()[p.s] + p.f, i * beat + k * 0.03, 0.45));
      playTimers.push(setTimeout(() => { playingMarks = marks; drawOverlay(); }, i * beat * 1000));
    });
    playTimers.push(setTimeout(() => { playingMarks = []; drawOverlay(); }, seq.length * beat * 1000));
  }


  // ---------------- Menu & sections ----------------
  const SECTIONS = { home: 'Scales & chords', tab: 'Tab player', circle: 'Circle of fifths', practice: 'Practice & lessons', input: 'Input & tuner' };
  function openMenu(open) {
    $('drawer').classList.toggle('open', open);
    $('drawer-backdrop').classList.toggle('hidden', !open);
    $('menu-btn').setAttribute('aria-expanded', String(open));
  }
  function showSection(name) {
    if (!SECTIONS[name]) name = 'home';
    const leaving = state.section;
    state.section = name;
    // Leaving a section stops what it was doing, so the neck shows the new section's notes
    if (leaving === 'tab' && name !== 'tab') { stopTab(); if (tab.follow) setFollow(false); }
    if (leaving === 'practice' && name !== 'practice' && practice.on) togglePractice();
    document.querySelectorAll('[data-section]').forEach((c) => c.classList.toggle('off-section', c.dataset.section !== name));
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.go === name));
    $('section-name').textContent = name === 'home' ? '' : '› ' + SECTIONS[name];
    openMenu(false);
    render();
    document.querySelector('main').scrollTop = 0;
  }
  function setupMenu() {
    $('menu-btn').onclick = () => openMenu(!$('drawer').classList.contains('open'));
    $('drawer-close').onclick = () => openMenu(false);
    $('drawer-backdrop').onclick = () => openMenu(false);
    document.querySelectorAll('.nav-item').forEach((b) => { b.onclick = () => showSection(b.dataset.go); });
    $('listen-chip').onclick = () => showSection('input');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openMenu(false); });
    showSection(state.section);
  }

  // ---------------- Side panel ----------------
  function renderInfo() {
    const isScale = state.mode === 'scale';
    $('scale-wrap').classList.toggle('hidden', !isScale);
    $('chord-wrap').classList.toggle('hidden', isScale);
    $('voicing-nav').classList.toggle('hidden', state.mode !== 'chord');
    $('chord-check-row').classList.toggle('hidden', state.mode !== 'chord');
    if (state.mode !== 'chord') { $('chord-feedback').textContent = ''; $('chord-feedback').className = 'chord-feedback'; }

    const rootName = name(state.root);
    if (isScale) $('title').textContent = `${rootName} ${T.SCALES[state.scale].name}`;
    else {
      const c = T.CHORDS[state.chord];
      $('title').textContent = `${rootName}${c.symbol} — ${c.name} ${state.mode === 'arpeggio' ? 'arpeggio' : 'chord'}`;
    }

    const list = $('notes-list');
    list.innerHTML = '';
    for (const p of activePcs()) {
      const semis = T.pc(p - state.root);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.setProperty('--c', colorFor(semis));
      chip.innerHTML = `${noteLabel(p)}<small>${T.INTERVALS[semis]}</small>`;
      list.appendChild(chip);
    }

    renderShapes();
    renderCircle();
    if (state.mode === 'chord') {
      const all = voicings();
      const v = currentVoicing();
      $('voicing-label').textContent = v ? `${voicingIndex + 1}/${all.length}:  ${T.formatVoicing(v)}` : 'No voicing found';
      $('prev').disabled = $('next').disabled = all.length < 2;
    }

    if (tabView()) {
      $('legend').innerHTML = '<span style="--c:var(--good)">Play now</span><span style="--c:transparent">Dashed rings 2, 3, 4 = coming next</span>';
      return;
    }
    $('legend').innerHTML = [
      ['var(--root)', 'Root'], ['var(--third)', '3rd'], ['var(--fifth)', '5th'],
      ['var(--seventh)', '7th'], ['var(--other)', '2nd / 4th / 6th'],
    ].map(([c, l]) => `<span style="--c:${c}">${l}</span>`).join('');
  }

  function render() {
    renderInfo();
    drawBoard();
    save();
    fillLessonPos();
    fillScalePos();
    // Scale, chord or tuning changed: keep practice targets inside the new notes/area.
    if (practice.on && state.practiceType === 'lesson') {
      const order = T.scaleLesson(tuning(), activePcs(), lessonStartFor(practice.posIdx));
      if (JSON.stringify(order) !== JSON.stringify(practice.order)) { // scale, root or position changed
        practice.order = [];
        nextTarget();
        drawBoard();
        renderPractice('Lesson restarted for the new scale/position.', '');
      }
    } else if (practice.on) {
      const t = practice.target;
      if (!t || !practicePool().some((p) => p.s === t.s && p.f === t.f)) nextTarget();
    }
  }

  // ---------------- Sound ----------------
  let playTimers = [];
  function clearPlayback() {
    playTimers.forEach(clearTimeout);
    playTimers = [];
    synth.stopAll();
    playingMarks = [];
    drawOverlay();
  }

  function flash(marks, ms) {
    playingMarks = playingMarks.concat(marks);
    drawOverlay();
    playTimers.push(setTimeout(() => {
      playingMarks = playingMarks.filter((p) => !marks.includes(p));
      drawOverlay();
    }, ms));
  }

  function playNote(midi, pos) {
    if (pos.f > 0) { handPos = pos; handTime = performance.now(); } // clicking a fret tells live input where your hand is
    synth.play(midi);
    flash([pos], 400);
  }

  /** Play a list of {s, f, midi} notes as eighth notes, lighting each one on the neck. */
  function playOrder(order) {
    clearPlayback();
    const step = 60 / state.tempo / 2;
    order.forEach((p, i) => {
      synth.play(p.midi, i * step);
      playTimers.push(setTimeout(() => { playingMarks = [{ s: p.s, f: p.f }]; drawOverlay(); }, i * step * 1000));
    });
    playTimers.push(setTimeout(() => { playingMarks = []; drawOverlay(); }, order.length * step * 1000 + 300));
  }

  let demoUntil = 0;
  /** Practice card: play the position being practised (or the one picked), low E up to high e and back. */
  function playLessonScale() {
    let order;
    if (isLesson() && practice.order.length) order = practice.order;
    else order = T.scaleLesson(tuning(), activePcs(), lessonStartFor(lessonSingle() ? Number(state.scalePos) : 0));
    playOrder(order.map((p) => ({ s: p.s, f: p.f, midi: p.midi !== undefined ? p.midi : tuning()[p.s] + p.f })));
    demoUntil = performance.now() + (order.length * 30 / state.tempo + 1) * 1000;
  }

  function playCurrent() {
    clearPlayback();
    const beat = 60 / state.tempo;
    if (state.mode === 'chord') {
      const v = currentVoicing();
      if (!v) return;
      const marks = v.map((f, s) => (f === null ? null : { s, f })).filter(Boolean);
      marks.forEach((p, i) => synth.play(tuning()[p.s] + p.f, i * 0.035, 0.5));
      flash(marks, 1500);
      return;
    }
    const step = beat / 2; // eighth notes
    if (state.mode === 'scale') {
      // Play a scale position the way it's played: low E string up to high e, then back down.
      const list = scalePositionsNow();
      const start = scaleBoxNow() ? scaleBoxNow().start : list.length ? list[0] : 0;
      playOrder(T.scaleLesson(tuning(), activePcs(), start));
      return;
    }
    const seq = T.buildRun(tuning(), state.root, activePcs(), 2);
    let near = null;
    seq.forEach((m, i) => {
      const pos = bestPosition(m, near);
      near = pos || near;
      synth.play(m, i * step);
      playTimers.push(setTimeout(() => {
        playingMarks = pos ? [pos] : [];
        drawOverlay();
      }, i * step * 1000));
    });
    playTimers.push(setTimeout(() => {
      playingMarks = [];
      drawOverlay();
    }, seq.length * step * 1000 + 300));
  }

  const stringLabel = (s) => `${T.noteName(tuning()[s], state.flats)} string (${tuning().length - s})`;
  let noteOnAt = 0; // when the current note started (new pitch or re-pluck)
  let lastOnset = -Infinity;

  // ---------------- Practice mode & lessons ----------------
  const practice = {
    on: false, target: null, order: [], idx: 0, shownAt: 0, startedAt: 0, lessonStart: 0, posIdx: 0, posMistakes: 0,
    right: 0, wrong: 0, streak: 0, best: 0, times: [], lastWrongAt: 0,
  };
  const isLesson = () => practice.on && state.practiceType === 'lesson';
  const fretSpan = (notes) => {
    const fr = notes.map((n) => n.f);
    return fr.length ? [Math.min(...fr), Math.max(...fr)] : null;
  };
  /** [lowest, highest] fret of the shaded area: the running lesson's position or the picked scale position. */
  function areaRange() {
    if (isLesson()) return fretSpan(practice.order);
    const box = scaleBoxNow();
    if (box && !practice.on) return fretSpan(box.notes);
    return handLock() === null ? null : [handLock(), handLock() + 4];
  }

  // ---------------- Scale positions (boxes) ----------------
  const scalePositionsNow = () => T.scalePositions(tuning(), activePcs(), state.frets, state.root);
  /** The scale position picked in Scale mode: {index, start, notes} or null for the whole neck. */
  function scaleBoxNow() {
    if (state.mode !== 'scale' || state.scalePos === 'all' || tabView()) return null;
    const list = scalePositionsNow();
    if (!list.length) return null;
    const index = Math.min(Number(state.scalePos), list.length - 1);
    return { index, start: list[index], notes: T.scaleBox(tuning(), activePcs(), list[index]) };
  }

  function fillScalePos() {
    $('scale-pos-row').classList.toggle('hidden', state.mode !== 'scale');
    if (state.mode !== 'scale') return;
    const list = scalePositionsNow();
    if (state.scalePos !== 'all' && Number(state.scalePos) >= list.length) state.scalePos = 'all';
    fillSelect($('scale-pos'), [['all', 'Whole neck']].concat(list.map((_, i) => [String(i), `Position ${i + 1}`])), state.scalePos);
  }

  function stepScalePos(d) {
    const n = scalePositionsNow().length;
    if (!n) return;
    const cur = state.scalePos === 'all' ? (d > 0 ? -1 : n) : Number(state.scalePos);
    state.scalePos = String((cur + d + n) % n);
    render();
  }

  /** While practising, the only notes shown on the neck: the lesson's position, or the practice area. */
  function practiceArea() {
    if (!practice.on) return null;
    if (isLesson()) return new Set(practice.order.map((p) => p.s + ':' + p.f));
    if (handLock() === null) return null;
    return new Set(practicePool().map((p) => p.s + ':' + p.f));
  }

  /** The main card and the practice card share one tempo. */
  function syncTempo() {
    $('tempo').value = state.tempo; $('tempo-val').textContent = state.tempo;
    $('lesson-tempo').value = state.tempo; $('lesson-tempo-val').textContent = state.tempo;
  }

  const lessonPositions = () => T.scalePositions(tuning(), activePcs(), state.frets, state.root);
  const lessonSingle = () => state.scalePos !== 'all';
  /** Start fret of lesson position i (0 = position 1). */
  function lessonStartFor(i) {
    const list = lessonPositions();
    return list.length ? list[Math.max(0, Math.min(i, list.length - 1))] : 0;
  }

  function fillLessonPos() {
    const list = lessonPositions();
    const entries = [['all', 'Automatic (moves up through every position)']].concat(
      list.map((f, i) => [String(i), `Position ${i + 1}`]),
    );
    if (state.scalePos !== 'all' && Number(state.scalePos) >= list.length) state.scalePos = 'all';
    fillSelect($('lesson-pos'), entries, state.scalePos);
    $('lesson-pos-row').classList.toggle('hidden', state.practiceType !== 'lesson');
  }

  function practicePool() {
    const lock = handLock();
    const lo = lock === null ? 0 : lock, hi = lock === null ? state.frets : lock + 4;
    const pcs = new Set(activePcs());
    const pool = [];
    tuning().forEach((open, s) => {
      for (let f = lo; f <= hi; f++) {
        const midi = open + f;
        if (pcs.has(T.pc(midi))) pool.push({ s, f, midi });
      }
    });
    return pool;
  }

  function startLesson() {
    if (lessonSingle()) practice.posIdx = Number(state.scalePos);
    practice.lessonStart = lessonStartFor(practice.posIdx);
    practice.order = T.scaleLesson(tuning(), activePcs(), practice.lessonStart);
    practice.idx = 0;
    practice.startedAt = performance.now();
  }

  function nextTarget() {
    if (state.practiceType === 'lesson') {
      if (!practice.order.length) startLesson();
      practice.target = practice.order[practice.idx] || null;
    } else {
      const pool = practicePool().filter((p) => !practice.target || p.midi !== practice.target.midi);
      practice.target = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    practice.shownAt = performance.now();
    renderPractice();
    drawOverlay();
  }

  function renderPractice(feedback, cls) {
    $('practice-toggle').textContent = practice.on ? 'Stop' : state.practiceType === 'lesson' ? 'Start lesson' : 'Start practice';
    const t = practice.target;
    let head = '–';
    if (practice.on && t) {
      const where = `${stringLabel(t.s)}, ${t.f === 0 ? 'open' : 'fret ' + t.f}`;
      head = state.practiceType === 'lesson'
        ? `Note ${practice.idx + 1} of ${practice.order.length}: ${T.noteNameWithOctave(t.midi, state.flats)} — ${where}`
        : `Play ${T.noteNameWithOctave(t.midi, state.flats)} — ${where}`;
    } else if (practice.on) {
      head = 'No notes to practise — change the scale';
    }
    $('practice-target').textContent = head;
    $('lesson-info').textContent = isLesson()
      ? `${$('title').textContent.split(' — ')[0]}, position ${practice.posIdx + 1}${lessonSingle() ? '' : ` of ${lessonPositions().length}`}. Play each note in turn — the green circle is next, then 2, 3, 4.`
      : '';
    if (feedback !== undefined) {
      $('practice-feedback').textContent = feedback;
      $('practice-feedback').className = cls || '';
    }
    $('p-right').textContent = practice.right;
    $('p-wrong').textContent = practice.wrong;
    $('p-streak').textContent = practice.streak;
    $('p-best').textContent = practice.best;
    const avg = practice.times.length ? practice.times.reduce((a, b) => a + b, 0) / practice.times.length : 0;
    $('p-time').textContent = avg ? (avg / 1000).toFixed(1) + ' s' : '–';
  }

  async function togglePractice() {
    if (practice.on) {
      practice.on = false;
      practice.target = null;
      renderPractice('', '');
      render();
      return;
    }
    if (!input.active) await startListening();
    if (!input.active) return;
    Object.assign(practice, { on: true, target: null, order: [], idx: 0, right: 0, wrong: 0, streak: 0, best: 0, times: [], posIdx: 0, posMistakes: 0 });
    nextTarget();
    render(); // shade the lesson's area
    renderPractice(state.practiceType === 'lesson' ? 'Start with note 1 (green circle).' : 'Go!', '');
  }

  function finishLesson(now) {
    const secs = Math.round((now - practice.startedAt) / 1000);
    const notes = practice.order.length;
    const list = lessonPositions();
    const wrongHere = practice.wrong - practice.posMistakes;
    if (!lessonSingle() && practice.posIdx + 1 < list.length) {
      // On to the next position up the neck
      practice.posIdx++;
      practice.posMistakes = practice.wrong;
      startLesson();
      nextTarget();
      render();
      renderPractice(`✓ Position ${practice.posIdx} done (${secs} s, ${wrongHere} mistake${wrongHere === 1 ? '' : 's'}). Now position ${practice.posIdx + 1}.`, 'yes');
      return;
    }
    if (lessonSingle()) {
      // Same position again, so it can be drilled
      practice.posMistakes = practice.wrong;
      startLesson();
      nextTarget();
      render();
      renderPractice(`🎉 Position ${practice.posIdx + 1} complete! ${notes} notes in ${secs} s with ${wrongHere} mistake${wrongHere === 1 ? '' : 's'}. Going again — press Stop to finish.`, 'yes');
      return;
    }
    practice.on = false;
    practice.target = null;
    renderPractice(`🎉 All ${list.length} positions complete, with ${practice.wrong} mistake${practice.wrong === 1 ? '' : 's'} in total! Press Start lesson to go again.`, 'yes');
    render();
  }

  /** In a lesson the app knows what should come next, so a played note can be placed exactly. */
  function lessonPosition(midi) {
    if (!isLesson()) return null;
    const near = practice.order.slice(Math.max(0, practice.idx - 1), practice.idx + 4);
    return near.find((p) => p.midi === midi) || null;
  }

  function practiceNoteOn(midi, now) {
    const t = practice.target;
    if (!practice.on || !t) return;
    if (performance.now() < demoUntil) return; // the app is playing the scale itself; don't score it
    if (midi === t.midi) {
      practice.right++;
      practice.streak++;
      practice.best = Math.max(practice.best, practice.streak);
      practice.times.push(now - practice.shownAt);
      if (practice.times.length > 20) practice.times.shift();
      livePos = { s: t.s, f: t.f }; // we know exactly where it was meant to be played
      if (state.practiceType === 'lesson') {
        practice.idx++;
        if (practice.idx >= practice.order.length) return finishLesson(now);
        nextTarget();
        renderPractice('✓', 'yes');
        return;
      }
      renderPractice('✓ Correct!', 'yes');
      drawOverlay();
      const done = practice.target;
      setTimeout(() => { if (practice.on && practice.target === done) nextTarget(); }, 450);
    } else if (now - practice.lastWrongAt > 300) {
      practice.lastWrongAt = now;
      practice.wrong++;
      practice.streak = 0;
      const what = state.practiceType === 'lesson' ? 'next is' : 'try';
      renderPractice(`✗ That was ${T.noteNameWithOctave(midi, state.flats)} — ${what} ${T.noteNameWithOctave(t.midi, state.flats)} (${stringLabel(t.s)}, ${t.f === 0 ? 'open' : 'fret ' + t.f})`, 'no');
    }
  }

  // ---------------- Chord checking ----------------
  let chordOnset = -Infinity; // onset already checked
  const chordLog = [];
  const ROLE = (rootPc, pc) => ({ 0: 'root', 3: '3rd', 4: '3rd', 7: '5th', 10: '7th', 11: '7th', 9: '6th', 2: '9th', 5: '4th' })[T.pc(pc - rootPc)] || '';

  function chordName() {
    const c = T.CHORDS[state.chord];
    return `${name(state.root)}${c.symbol || ''} (${name(state.root)} ${c.name.toLowerCase()})`;
  }

  function mistakeText(m, shape) {
    if (!m) return '';
    const lbl = stringLabel(m.s);
    if (m.kind === 'not-ringing') return `Check the ${lbl} is ringing clearly.`;
    if (m.kind === 'should-be-muted') return `Mute the ${lbl} - it shouldn't ring.`;
    if (m.kind === 'wrong-fret') return `The ${lbl} sounds like fret ${m.fret} - it should be ${shape[m.s] === 0 ? 'open' : 'fret ' + shape[m.s]}.`;
    return '';
  }

  function checkChordStrum(frame, now) {
    if (!state.checkChord || state.mode !== 'chord') return;
    if (gate.attackStart === chordOnset || now - gate.attackStart < 200 || now - gate.attackStart > 600) return;
    chordOnset = gate.attackStart;
    // A single plucked note is a clean, regular waveform; a chord isn't. Don't judge single notes.
    if (frame.freq > 0 && frame.clarity >= 0.9) return;
    const profile = window.ChordCheck.chroma(frame.long.slice(), frame.sampleRate);
    const shape = currentVoicing();
    const pcs = T.chordPcs(state.root, state.chord);
    const res = window.ChordCheck.check(profile, pcs, shape, tuning());
    chordLog.push({ t: Math.round(now), status: res.status, missing: res.missing, extra: res.extra, mistake: res.mistake, profile });
    if (chordLog.length > 6) chordLog.shift();
    const box = $('chord-feedback');
    if (res.status === 'not-a-chord') return;
    if (res.status === 'correct') {
      box.textContent = `✓ ${chordName()} - correct!`;
      box.className = 'chord-feedback yes';
      if (shape) flash(shape.map((f, s) => (f === null ? null : { s, f })).filter(Boolean), 900);
    } else {
      const parts = [];
      if (res.missing.length) parts.push('missing ' + res.missing.map((pc) => `${name(pc)} (${ROLE(state.root, pc)})`).join(', '));
      if (res.extra.length) parts.push('extra ' + res.extra.map((pc) => name(pc)).join(', '));
      let hint = mistakeText(res.mistake, shape || []);
      if (state.chord === '5' && res.extra.length && !res.missing.length) hint = 'A power chord is just the strings shown - mute the others.';
      box.textContent = `✗ Not quite: ${parts.join('; ')}. ${hint}`.trim();
      box.className = 'chord-feedback no';
    }
  }

  // ---------------- Tab player ----------------
  const tab = { song: null, text: '', idx: 0, playing: false, timer: null, follow: false, lastWrongAt: 0, chordOnset: -Infinity, mistakes: 0,
    along: false, counting: false, results: [], best: 0, pass: 0 };
  const tabShown = () => !!(tab.song && tab.song.events.length);
  /** The neck shows the tab (not the scale) unless practice is running. */
  const tabView = () => tabShown() && !practice.on && state.section === 'tab';
  const tabEvent = (i = tab.idx) => (tab.song && tab.song.events[i]) || null;
  const tabMidis = (ev) => ev.notes.map((n) => tuning()[n.s] + n.pitch);
  const TECH_SHORT = { 'hammer-on': 'h', 'pull-off': 'p', 'slide up': '/', 'slide down': '\\', slide: 's', bend: 'b', release: 'r', tap: 't' };
  const EXAMPLE_TAB = `Example: A minor warm-up (made for Guitar Visualizer)

Part 1 - A minor pentatonic, up and down
e|-----------------------5-8-|-5-------------------------|
B|-------------------5-8-----|---8-5---------------------|
G|---------------5-7---------|-------7-5-----------------|
D|---------5-7---------------|-----------7-5-------------|
A|---5-7---------------------|---------------7-5---------|
E|-5-------------------------|-------------------8-5-----|

Part 2 - picking through Am, C and G
   Am                  C                   G
e|-0-----0-----0-----|-0-----0-----0-----|-3-----3-----3-----|
B|---1-----1-----1---|---1-----1-----1---|---0-----0-----0---|
G|-----2-----2-------|-----0-----0-------|-----0-----0-------|
D|-------------------|-------------------|-------------------|
A|-0-----------------|-3-----------------|-------------------|
E|-------------------|-------------------|-3-----------------|

Part 3 - a lick with a hammer-on, pull-off and bend
e|-----------------5-8p5-----|---------------|
B|-----------5h8---------8---|-8b10r8-5------|
G|-----5-7-------------------|---------7-5---|
D|-5h7-----------------------|-------------7-|
A|---------------------------|---------------|
E|---------------------------|---------------|

Part 4 - strum the chords (each column is played together)
   Am      C       G       E
e|-0-------0-------3-------0-------|
B|-1-------1-------0-------0-------|
G|-2-------0-------0-------1-------|
D|-2-------2-------0-------2-------|
A|-0-------3-------2-------2-------|
E|---------3-------3-------0-------|
`;

  /** Name of the chord a set of notes makes (e.g. "Am"), or ''. */
  function chordNameOf(midis) {
    const set = new Set(midis.map(T.pc));
    const low = T.pc(Math.min(...midis));
    let best = '';
    for (const root of [low, ...set]) {
      for (const [id, c] of Object.entries(T.CHORDS)) {
        const pcs = T.chordPcs(root, id);
        if (pcs.length === set.size && pcs.every((p) => set.has(p))) {
          const nm = name(root) + (c.symbol || '') + (root !== low ? '/' + name(low) : '');
          if (!best || root === low) best = nm;
          if (root === low) return best;
        }
      }
    }
    return best;
  }

  function techText(n) {
    if (n.tech === 'bend') return `bend up to sound like fret ${n.pitch}`;
    if (n.tech === 'release') return 'release the bend';
    return n.tech;
  }

  function describeStep(ev) {
    const midis = tabMidis(ev);
    if (ev.notes.length >= 3) {
      const shape = tuning().map((_, s) => { const n = ev.notes.find((x) => x.s === s); return n ? String(n.f) : 'x'; }).join(' ');
      const nm = chordNameOf(midis);
      return `${nm ? nm + ' chord' : 'Chord'}: ${shape}  (low → high string)`;
    }
    return ev.notes.map((n, i) =>
      `${T.noteNameWithOctave(midis[i], state.flats)} — ${stringLabel(n.s)}, ${n.f === 0 ? 'open' : 'fret ' + n.f}${n.tech ? ' (' + techText(n) + ')' : ''}`,
    ).join('   +   ');
  }

  function loadTab(text, startIdx = 0) {
    stopTab();
    const song = window.TabReader.parse(text);
    const tid = song.events.length ? window.TabReader.matchTuning(song, T.TUNINGS, state.tuning) : null;
    if (!song.events.length || !tid) {
      $('tab-status').textContent = song.events.length ? `This tab has ${song.strings} strings - there's no tuning for that.` : song.warnings.join(' ');
      return false;
    }
    const msgs = [];
    if (tid !== state.tuning) {
      state.tuning = tid;
      $('tuning').value = tid;
      msgs.push(`Tuning set to ${T.TUNINGS[tid].name} to match the tab.`);
      restartIfListening();
    }
    const maxF = Math.max(...song.events.flatMap((e) => e.notes.map((n) => Math.max(n.f, n.pitch))));
    if (maxF > state.frets) {
      state.frets = [12, 15, 17, 21, 22, 24].find((x) => x >= maxF) || 24;
      $('frets').value = String(state.frets);
    }
    tab.song = song;
    tab.text = text;
    tab.idx = Math.max(0, Math.min(startIdx, song.events.length - 1));
    tab.mistakes = 0;
    const bars = song.events[song.events.length - 1].bar + 1;
    $('tab-status').textContent = [`Loaded ${song.events.length} steps in ${bars} bar${bars === 1 ? '' : 's'}.`, ...msgs, ...song.warnings].join(' ');
    try { localStorage.setItem('gv-tab', JSON.stringify({ text, idx: tab.idx })); } catch { /* ignore */ }
    $('tab-paste-box').classList.add('hidden');
    renderTabView();
    updateTabUi();
    render();
    updateTabStep();
    return true;
  }

  function closeTab() {
    stopTab();
    tab.song = null;
    tab.follow = false;
    $('tab-follow').checked = false;
    $('tab-status').textContent = '';
    $('tab-view').innerHTML = '';
    try { localStorage.removeItem('gv-tab'); } catch { /* ignore */ }
    updateTabUi();
    render();
  }

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function renderTabView() {
    const view = $('tab-view');
    view.innerHTML = '';
    if (!tabShown()) return;
    const song = tab.song;
    song.systems.forEach((sys, si) => {
      const L = Math.max(...sys.bodies.map((b) => b.length));
      const owner = new Array(L).fill(-1);
      song.events.forEach((ev, i) => { if (ev.sys === si) for (let c = ev.col; c <= ev.end; c++) owner[c] = i; });
      const lw = Math.max(...sys.labels.map((l) => l.length));
      let html = '';
      sys.bodies.forEach((b, li) => {
        html += `<span class="lbl">${esc((sys.labels[li] || '').padEnd(lw))}|</span>`;
        const body = b.padEnd(L, '-');
        for (let c = 0; c < L;) {
          const o = owner[c];
          let d = c;
          while (d < L && owner[d] === o) d++;
          const seg = esc(body.slice(c, d));
          html += o < 0 ? seg : `<span class="ev" data-e="${o}">${seg}</span>`;
          c = d;
        }
        html += '\n';
      });
      const pre = document.createElement('pre');
      pre.className = 'tab-sys';
      pre.innerHTML = html;
      view.appendChild(pre);
    });
    view.querySelectorAll('.ev').forEach((node) => { node.title = `Step ${Number(node.dataset.e) + 1} - click to go here`; });
  }

  function highlightTab() {
    const view = $('tab-view');
    view.querySelectorAll('.ev').forEach((node) => {
      const i = Number(node.dataset.e);
      node.classList.toggle('cur', i === tab.idx);
      node.classList.toggle('soon', i > tab.idx && i <= tab.idx + 3);
      node.classList.toggle('done', i < tab.idx && !tab.results[i]);
      node.classList.toggle('hit', tab.results[i] === 'hit' && i !== tab.idx);
      node.classList.toggle('miss', tab.results[i] === 'miss' && i !== tab.idx);
    });
    const cur = view.querySelector('.ev.cur');
    if (cur) {
      const vr = view.getBoundingClientRect(), r = cur.getBoundingClientRect();
      if (r.top < vr.top || r.bottom > vr.bottom) view.scrollTop += r.top - vr.top - 30;
      if (r.left < vr.left + 20 || r.right > vr.right - 20) view.scrollLeft += r.left - vr.left - vr.width / 3;
    }
  }

  function updateTabUi() {
    const shown = tabShown();
    $('tab-controls').classList.toggle('hidden', !shown);
    $('tab-close').classList.toggle('hidden', !shown);
    $('tab-play').textContent = tab.playing && !tab.along ? '❚❚ Pause' : '▶ Play';
    $('tab-along').textContent = tab.along ? '■ Stop' : '🎯 Play along';
  }

  function updateTabStep() {
    const ev = tabEvent();
    if (!ev) return;
    const n = tab.song.events.length;
    $('tab-pos').textContent = `Step ${tab.idx + 1} of ${n} · bar ${ev.bar + 1}`;
    $('tab-now').textContent = describeStep(ev);
    highlightTab();
    drawOverlay();
    try { localStorage.setItem('gv-tab', JSON.stringify({ text: tab.text, idx: tab.idx })); } catch { /* ignore */ }
  }

  function playTabEvent(ev) {
    tabMidis(ev).forEach((m, i) => synth.play(m, i * 0.03, ev.notes.length > 2 ? 0.45 : 0.7));
  }

  function gotoStep(i, sound) {
    if (!tabShown()) return;
    const n = tab.song.events.length;
    tab.idx = Math.max(0, Math.min(n - 1, i));
    if (sound) playTabEvent(tabEvent());
    updateTabStep();
  }

  function stopTab() {
    clearTimeout(tab.timer);
    tab.timer = null;
    tab.playing = false;
    if (tab.along) { tab.along = false; tab.counting = false; showScore(false); }
    if (tab.song) updateTabUi();
  }

  const colMs = () => (90 * 100) / state.tabSpeed; // one "-" of tab

  function playTab() {
    if (!tabShown()) return;
    if (tab.playing) { stopTab(); return; }
    const n = tab.song.events.length;
    if (tab.idx >= n - 1) tab.idx = 0;
    tab.playing = true;
    updateTabUi();
    runTab(true);
  }

  /** Steps through the tab in time. In play-along, each step is scored as it goes by. */
  function runTab(sound) {
    const n = tab.song.events.length;
    const step = () => {
      const ev = tabEvent();
      if (!ev) { stopTab(); return; }
      if (tab.along) {
        tab.stepAt = performance.now();
        const prev = tab.idx - 1;
        // a note played up to 350 ms late still counts for the step before
        if (prev >= 0) setTimeout(() => { if (tab.along && !tab.results[prev]) { tab.results[prev] = 'miss'; showScore(true); highlightTab(); } }, 350);
      }
      updateTabStep();
      if (sound) playTabEvent(ev);
      const wait = Math.min(Math.max(ev.gap, 2), 12) * colMs();
      tab.timer = setTimeout(() => {
        if (tab.idx + 1 < n) { tab.idx++; step(); return; }
        if (tab.along) {
          const last = tab.idx;
          if (!tab.results[last]) tab.results[last] = 'miss';
          finishAlong();
          if (!state.tabLoop) return;
          tab.along = true; tab.playing = true; tab.results = [];
          tab.idx = 0;
          updateTabUi();
          startAlongRun();
          return;
        }
        if (state.tabLoop) { tab.idx = 0; step(); return; }
        stopTab();
      }, wait);
    };
    step();
  }

  // ---------------- Play along (scored) ----------------
  function scoreCounts() {
    let hit = 0, miss = 0;
    tab.results.forEach((r) => { if (r === 'hit') hit++; else if (r === 'miss') miss++; });
    return { hit, miss };
  }

  function showScore(live) {
    const { hit, miss } = scoreCounts();
    const done = hit + miss;
    if (!done && live) { $('tab-score').textContent = ''; return; }
    const pct = done ? Math.round((hit / done) * 100) : 0;
    $('tab-score').textContent = `✓ ${hit} hit · ✗ ${miss} missed${done ? ` · ${pct}%` : ''}${tab.best ? ` · best ${tab.best}%` : ''}`;
  }

  function finishAlong() {
    const { hit, miss } = scoreCounts();
    const pct = hit + miss ? Math.round((hit / (hit + miss)) * 100) : 0;
    const newBest = pct > tab.best;
    tab.best = Math.max(tab.best, pct);
    tab.pass++;
    clearTimeout(tab.timer);
    tab.along = false;
    tab.playing = false;
    updateTabUi();
    showScore(false);
    highlightTab();
    const msg = pct >= 95 ? '🎉 Brilliant!' : pct >= 80 ? '👍 Great!' : pct >= 50 ? 'Getting there!' : 'Keep at it - try a slower speed.';
    tabFeedback(`${msg} You hit ${hit} of ${hit + miss} (${pct}%)${newBest && tab.pass > 1 ? ' - new best!' : ''}${pct >= 90 && state.tabSpeed < 200 ? ' Try it a bit faster?' : ''}`, pct >= 50 ? 'yes' : 'no');
  }

  function startAlongRun() {
    const beat = colMs() * 4;
    const go = () => { if (tab.along) { tab.counting = false; tabFeedback('Play!', ''); runTab(state.alongSound); } };
    if (!state.countIn) { go(); return; }
    tab.counting = true;
    for (let i = 0; i < 4; i++) {
      synth.click(i === 0, (i * beat) / 1000);
      setTimeout(() => { if (tab.along) tabFeedback(`Count-in: ${i + 1}…`, ''); }, i * beat);
    }
    tab.timer = setTimeout(go, 4 * beat);
  }

  async function toggleAlong() {
    if (!tabShown()) return;
    if (tab.along) { stopTab(); tabFeedback('Stopped.', ''); return; }
    stopTab();
    if (tab.follow) setFollow(false);
    if (practice.on) togglePractice();
    if (!input.active) await startListening();
    if (!input.active) return;
    tab.along = true;
    tab.playing = true;
    tab.results = [];
    if (tab.idx >= tab.song.events.length - 1) tab.idx = 0;
    $('tab-score').textContent = '';
    updateTabUi();
    highlightTab();
    startAlongRun();
  }

  /** Play along: does this note (or strum) match the step now, or the one just gone (a little late)? */
  function alongHit(matches, at) {
    if (!tab.along || tab.counting) return;
    // `at` = when the note was played. Played before this step began -> it was for the step before;
    // up to 350 ms into a step it may still be a late note for the step before.
    const cands = at < tab.stepAt ? [tab.idx - 1, tab.idx] : at - tab.stepAt < 350 ? [tab.idx, tab.idx - 1] : [tab.idx];
    for (const i of cands) {
      const ev = tabEvent(i);
      if (ev && !tab.results[i] && matches(ev)) {
        tab.results[i] = 'hit';
        showScore(true);
        highlightTab();
        return;
      }
    }
  }

  function tabFeedback(text, cls) {
    $('tab-feedback').textContent = text;
    $('tab-feedback').className = cls || '';
  }

  async function setFollow(on) {
    tab.follow = on;
    $('tab-follow').checked = on;
    if (!on) { tabFeedback('', ''); return; }
    stopTab();
    if (practice.on) togglePractice();
    if (!input.active) await startListening();
    if (!input.active) { tab.follow = false; $('tab-follow').checked = false; return; }
    tab.mistakes = 0;
    tabFeedback('Listening - play the green note(s).', '');
  }

  /** While following a tab the app knows what comes next, so a played note can be placed exactly. */
  function tabPosition(midi) {
    if (!tabShown()) return null;
    for (const i of [tab.idx, tab.idx + 1, tab.idx - 1, tab.idx + 2, tab.idx + 3]) {
      const ev = tabEvent(i);
      if (!ev) continue;
      const k = tabMidis(ev).indexOf(midi);
      if (k >= 0) return { s: ev.notes[k].s, f: ev.notes[k].f };
    }
    return null;
  }

  function tabAdvance() {
    const n = tab.song.events.length;
    if (tab.idx + 1 < n) {
      tab.idx++;
      tabFeedback('✓', 'yes');
    } else {
      tabFeedback(`🎉 You played the whole tab${tab.mistakes ? ` with ${tab.mistakes} wrong note${tab.mistakes === 1 ? '' : 's'}` : ' with no mistakes'}!${state.tabLoop ? ' Going again…' : ''}`, 'yes');
      tab.mistakes = 0;
      if (state.tabLoop) tab.idx = 0;
    }
    updateTabStep();
  }

  const noteMatches = (ev, midi) => {
    const want = tabMidis(ev);
    return want.includes(midi) || (ev.notes.length > 1 && want.some((m) => T.pc(m) === T.pc(midi)));
  };

  function tabNoteOn(midi, now) {
    if (tab.along) { alongHit((ev) => noteMatches(ev, midi), Math.min(now, gate.attackStart > 0 ? gate.attackStart + 60 : now)); return; }
    if (!tab.follow || tab.playing || !tabShown()) return;
    const ev = tabEvent();
    // For a chord the app usually hears just one of its notes, so any note of the chord counts.
    if (noteMatches(ev, midi)) { tabAdvance(); return; }
    if (now - tab.lastWrongAt < 300) return;
    tab.lastWrongAt = now;
    tab.mistakes++;
    tabFeedback(`✗ That was ${T.noteNameWithOctave(midi, state.flats)} - this step is ${describeStep(ev)}`, 'no');
  }

  /** Chord steps: check the whole strum, as the pitch detector can't follow several notes at once. */
  const strumMatches = (ev, profile) => {
    const midis = tabMidis(ev);
    const low = Math.min(...midis);
    const pcs = [T.pc(low), ...new Set(midis.map(T.pc).filter((p) => p !== T.pc(low)))];
    return window.ChordCheck.evaluate(profile, pcs).status === 'correct';
  };

  function tabChordStrum(frame, now) {
    if (!tabShown() || !(tab.along || (tab.follow && !tab.playing))) return;
    const ev = tabEvent();
    const prev = tabEvent(tab.idx - 1);
    if (!ev || (ev.notes.length < 3 && !(tab.along && prev && prev.notes.length >= 3))) return;
    if (gate.attackStart === tab.chordOnset || now - gate.attackStart < 200 || now - gate.attackStart > 600) return;
    tab.chordOnset = gate.attackStart;
    if (tab.along) {
      const profile = window.ChordCheck.chroma(frame.long.slice(), frame.sampleRate);
      alongHit((e) => e.notes.length >= 3 && strumMatches(e, profile), gate.attackStart);
      return;
    }
    if (ev.notes.length < 3) return;
    const midis = tabMidis(ev);
    const low = Math.min(...midis);
    const pcs = [T.pc(low), ...new Set(midis.map(T.pc).filter((p) => p !== T.pc(low)))];
    const profile = window.ChordCheck.chroma(frame.long.slice(), frame.sampleRate);
    const res = window.ChordCheck.evaluate(profile, pcs);
    if (res.status === 'correct') tabAdvance();
  }

  function drawTabOverlay(mark) {
    const cur = tabEvent();
    if (!cur) return;
    const drawn = new Set(cur.notes.map((n) => n.s + ':' + n.f));
    for (let k = 1; k <= 3; k++) {
      const ev = tabEvent(tab.idx + k);
      if (!ev) break;
      ev.notes.forEach((n) => {
        const key = n.s + ':' + n.f;
        if (drawn.has(key)) return;
        drawn.add(key);
        mark(n, 'next next' + k);
        const t = el('text', { x: geom.X(geom.noteX(n.f)) + 13, y: geom.sy(n.s) - 12, class: 'next-num' }, liveLayer);
        t.textContent = k + 1;
      });
    }
    const midis = tabMidis(cur);
    cur.notes.forEach((n, i) => {
      const cx = geom.X(geom.noteX(n.f)), cy = geom.sy(n.s);
      el('circle', { cx, cy, r: 12, class: 'dot tabnow' }, liveLayer);
      if (state.labels !== 'none') {
        const t = el('text', { x: cx, y: cy, class: 'dot-label' }, liveLayer);
        t.textContent = state.labels === 'intervals' ? String(n.f) : name(midis[i]);
      }
      mark(n, 'target');
      if (n.tech) {
        const t = el('text', { x: cx, y: cy - 19, class: 'tech' }, liveLayer);
        t.textContent = n.tech === 'bend' ? `bend→${n.pitch}` : TECH_SHORT[n.tech] || '';
      }
    });
  }

  function setupTab() {
    $('tab-open').onclick = () => $('tab-file').click();
    $('tab-file').onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (loadTab(String(reader.result))) $('tab-status').textContent = `${file.name}: ${$('tab-status').textContent}`;
      };
      reader.onerror = () => { $('tab-status').textContent = 'Could not read that file.'; };
      reader.readAsText(file);
      e.target.value = '';
    };
    $('tab-paste').onclick = () => {
      const box = $('tab-paste-box');
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) {
        if (!$('tab-text').value && tab.text) $('tab-text').value = tab.text;
        $('tab-text').focus();
      }
    };
    $('tab-load').onclick = () => loadTab($('tab-text').value);
    $('tab-example').onclick = () => { $('tab-text').value = EXAMPLE_TAB; loadTab(EXAMPLE_TAB); };
    $('tab-close').onclick = closeTab;
    $('tab-start').onclick = () => { stopTab(); gotoStep(0, false); };
    $('tab-prev').onclick = () => { stopTab(); gotoStep(tab.idx - 1, true); };
    $('tab-next').onclick = () => { stopTab(); gotoStep(tab.idx + 1, true); };
    $('tab-play').onclick = () => { if (tab.along) stopTab(); playTab(); };
    $('tab-along').onclick = toggleAlong;
    $('tab-countin').checked = state.countIn;
    $('tab-countin').onchange = (e) => { state.countIn = e.target.checked; save(); };
    $('tab-along-sound').checked = state.alongSound;
    $('tab-along-sound').onchange = (e) => { state.alongSound = e.target.checked; save(); };
    $('tab-view').onclick = (e) => {
      const t = e.target.closest('.ev');
      if (t) { stopTab(); gotoStep(Number(t.dataset.e), true); }
    };
    $('tab-speed').value = state.tabSpeed;
    $('tab-speed-val').textContent = state.tabSpeed;
    $('tab-speed').oninput = (e) => { state.tabSpeed = Number(e.target.value); $('tab-speed-val').textContent = state.tabSpeed; save(); };
    $('tab-loop').checked = state.tabLoop;
    $('tab-loop').onchange = (e) => { state.tabLoop = e.target.checked; save(); };
    $('tab-follow').onchange = (e) => setFollow(e.target.checked);
    try {
      const saved = JSON.parse(localStorage.getItem('gv-tab') || 'null');
      if (saved && saved.text) loadTab(saved.text, saved.idx || 0);
    } catch { /* ignore */ }
  }

  // ---------------- Live input ----------------
  const sensitivityToThreshold = (s) => 0.05 * Math.pow(0.02, s / 100);
  const gate = new window.NoteGate({ guitarOnly: state.guitarOnly });
  const diag = [];
  let diagInfo = {};
  let deviceLabel = '';

  async function copyDiagnostics() {
    const t0 = diag.length ? diag[0].t : 0;
    const n = (x, d = 3) => (x > 0 ? x.toFixed(d) : '-');
    const lines = [
      `Guitar Visualizer diagnostics  v${$('version').textContent.replace('v', '') || '?'}`,
      `device="${deviceLabel}" channel=${state.channel} guitarOnly=${state.guitarOnly} sensitivity=${state.sensitivity} gate=${n(gate.threshold, 4)}`,
      `tuning=${state.tuning} sampleRate=${diagInfo.sampleRate} window=${diagInfo.fftSize}`,
      ...chordLog.map((c) => `chord t=${c.t - t0} ${c.status} missing=${c.missing.map((p) => T.SHARPS[p]).join(',')} extra=${c.extra.map((p) => T.SHARPS[p]).join(',')} hint=${c.mistake ? c.mistake.kind + ':' + c.mistake.s + (c.mistake.fret !== undefined ? ':' + c.mistake.fret : '') : '-'} profile=${c.profile.map((v) => v.toFixed(2)).join(' ')}`),
      'ms     level  attack  freq     note  clarity onset decision        shown',
      ...diag.map((d) => [
        String(d.t - t0).padStart(5), n(d.lv, 4).padStart(6), n(d.al, 4).padStart(7),
        n(d.f, 1).padStart(7), (d.f > 0 ? T.noteNameWithOctave(T.freqToMidi(d.f)) : '-').padStart(5),
        n(d.c, 2).padStart(7), (d.on ? '  *  ' : '     '), d.why.padEnd(15),
        d.shown === null ? '-' : T.noteNameWithOctave(d.shown),
      ].join(' ')),
    ];
    try {
      const text = lines.join('\n');
      if (window.appApi && window.appApi.copyText) await window.appApi.copyText(text);
      else await navigator.clipboard.writeText(text);
      $('diag-status').textContent = 'Copied! Paste it into the chat.';
    } catch (err) {
      $('diag-status').textContent = 'Could not copy: ' + err.message;
    }
    setTimeout(() => { $('diag-status').textContent = ''; }, 4000);
  }
  const setThreshold = () => {
    input.threshold = gate.threshold = sensitivityToThreshold(state.sensitivity);
  };

  async function refreshDevices() {
    try {
      const devs = await input.devices();
      const entries = [['', 'System default']].concat(
        devs.filter((d) => d.deviceId && d.deviceId !== 'default')
          .map((d, i) => [d.deviceId, d.label || `Input ${i + 1}`])
      );
      fillSelect($('device'), entries, state.device);
      if ($('device').value !== state.device) $('device').value = '';
    } catch (err) {
      $('input-error').textContent = 'Could not list audio devices: ' + err.message;
    }
  }

  // Clears the display only. (Never reset the gate here: when a note fades out at the same
  // moment the next string is plucked, resetting would throw that pluck away.)
  function clearDetected() {
    if (liveMidi !== null) {
      liveMidi = null;
      livePos = null;
      drawOverlay();
    }
    $('detected-note').textContent = '–';
    $('detected-freq').textContent = '';
    $('cents').textContent = '';
    $('in-key').textContent = '';
    $('in-key').className = '';
    $('needle').style.left = '50%';
    $('needle').classList.remove('in-tune');
  }

  function onFrame(frame) {
    const db = 20 * Math.log10(frame.level || 1e-6);
    $('level').style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';

    const now = performance.now();
    const note = gate.push(frame, now);
    diag.push({
      t: Math.round(now), lv: frame.level, al: frame.attackLevel, f: frame.freq, c: frame.clarity,
      on: gate.onset, why: gate.reason || '', shown: note ? note.midi : null,
    });
    if (diag.length > 200) diag.shift(); // ~4 seconds
    diagInfo = { sampleRate: frame.sampleRate, fftSize: frame.fftSize };
    checkChordStrum(frame, now);
    tabChordStrum(frame, now);
    if (!note) {
      if (liveMidi !== null) clearDetected();
      return;
    }
    // Same pitch plucked again (settled, not mid-change) also counts as a new note.
    const repluck = gate.reason === 'same-note' && gate.attackStart !== lastOnset
      && gate.attackStart > noteOnAt && now - gate.attackStart >= 80;
    if (note.midi !== liveMidi || repluck) {
      liveMidi = note.midi;
      noteOnAt = now;
      lastOnset = gate.attackStart;
      const hand = now - handTime < 2000 ? handPos : null; // forget the hand after a 2 s pause
      livePos = (tab.follow && tabPosition(liveMidi)) || lessonPosition(liveMidi) || bestPosition(liveMidi, hand);
      if (livePos && livePos.f > 0) handPos = livePos; // open strings don't move the hand
      practiceNoteOn(liveMidi, now);
      tabNoteOn(liveMidi, now);
      drawOverlay();
    }
    handTime = now;
    const f = note.freq;
    const cents = note.cents;
    if (liveMidi === null) return;

    $('detected-note').textContent = T.noteNameWithOctave(liveMidi, state.flats);
    $('detected-freq').textContent = f.toFixed(1) + ' Hz';
    $('cents').textContent = (cents > 0 ? '+' : '') + cents + ' cents';
    $('needle').style.left = 50 + cents + '%';
    $('needle').classList.toggle('in-tune', Math.abs(cents) <= 5);
    const inKey = activePcs().includes(T.pc(liveMidi));
    $('in-key').textContent = inKey ? '✓ in ' + $('title').textContent.split(' — ')[0] : '✗ outside ' + $('title').textContent.split(' — ')[0];
    $('in-key').className = inKey ? 'yes' : 'no';
  }

  async function startListening() {
    $('input-error').textContent = '';
    const tun = tuning();
    try {
      deviceLabel = await input.start({
        deviceId: state.device,
        channel: state.channel,
        monitor: state.monitor,
        minFreq: T.midiToFreq(tun[0]) * 0.8,
        maxFreq: T.midiToFreq(tun[tun.length - 1] + state.frets) * 1.1,
        onFrame,
      });
      setThreshold();
      gate.reset();
      $('listen').textContent = '■ Stop listening';
      $('listen-chip').classList.remove('hidden');
      refreshDevices(); // labels become visible once permission is granted
    } catch (err) {
      $('input-error').textContent =
        err.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your system privacy settings.'
          : err.name === 'NotFoundError' || err.name === 'OverconstrainedError' ? 'That input device is not available. Pick another one.'
            : 'Could not start input: ' + err.message;
    }
  }

  function stopListening() {
    input.stop();
    $('listen').textContent = '🎤 Start listening';
    $('listen-chip').classList.add('hidden');
    $('level').style.width = '0%';
    gate.reset();
    clearDetected();
  }

  const restartIfListening = () => { if (input.active) startListening(); };

  // ---------------- Updates ----------------
  let userChecked = false;
  function setupUpdates() {
    const api = window.appApi;
    if (!api) return;
    api.getVersion().then((v) => { $('version').textContent = 'v' + v; });

    const banner = $('update-banner');
    const showBanner = (text, actionLabel, action) => {
      $('update-text').textContent = text;
      const btn = $('update-action');
      btn.classList.toggle('hidden', !actionLabel);
      btn.textContent = actionLabel || '';
      btn.onclick = action || null;
      banner.classList.remove('hidden');
    };
    $('update-dismiss').onclick = () => banner.classList.add('hidden');
    $('check-updates').onclick = () => { userChecked = true; api.checkForUpdates(); };

    api.onUpdateStatus((s) => {
      const status = $('update-status');
      switch (s.state) {
        case 'checking': status.textContent = 'Checking for updates…'; break;
        case 'none': status.textContent = userChecked ? "You're on the latest version." : ''; break;
        case 'dev': status.textContent = userChecked ? 'Updates are only checked in the installed app.' : ''; break;
        case 'available':
          status.textContent = '';
          showBanner(
            `Version ${s.version} is available.`,
            s.manual ? 'Open download page' : 'Download update',
            () => api.downloadUpdate()
          );
          break;
        case 'downloading':
          showBanner(`Downloading update… ${Math.round(s.percent || 0)}%`);
          break;
        case 'ready':
          showBanner(`Version ${s.version} is ready to install.`, 'Restart & update', () => api.installUpdate());
          break;
        case 'error':
          status.textContent = 'Update check failed.';
          status.title = s.message || '';
          if (!banner.classList.contains('hidden') && $('update-action').classList.contains('hidden')) {
            showBanner('Update download failed. Try again later.');
          }
          break;
      }
      if (s.state !== 'checking') userChecked = false;
    });
  }

  // ---------------- Wiring ----------------
  function fillRootSelect() {
    fillSelect($('root'), T.SHARPS.map((_, i) => [i, name(i)]), state.root);
  }

  function init() {
    fillRootSelect();
    fillSelect($('scale'), Object.entries(T.SCALES).map(([id, s]) => [id, s.name]), state.scale);
    fillSelect($('chord'), Object.entries(T.CHORDS).map(([id, c]) => [id, `${c.name} (${c.symbol || 'maj'})`]), state.chord);
    fillSelect($('tuning'), Object.entries(T.TUNINGS).map(([id, t]) => [id, t.name]), state.tuning);
    $('mode').value = state.mode;
    $('frets').value = String(state.frets);
    $('labels').value = state.labels;
    $('flats').checked = state.flats;
    $('lefty').checked = state.lefty;
    $('flip').checked = state.flip;
    syncTempo();
    $('channel').value = state.channel;
    $('monitor').checked = state.monitor;
    $('guitar-only').checked = state.guitarOnly;
    $('guitar-only').onchange = (e) => { state.guitarOnly = gate.guitarOnly = e.target.checked; save(); gate.reset(); clearDetected(); };
    $('sensitivity').value = state.sensitivity;

    const bind = (id, key, parse = (v) => v, after) => {
      $(id).addEventListener('change', (e) => {
        state[key] = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
        if (after) after();
        render();
      });
    };
    bind('mode', 'mode');
    bind('root', 'root', Number);
    bind('scale', 'scale');
    bind('chord', 'chord');
    bind('tuning', 'tuning', String, restartIfListening);
    bind('frets', 'frets', Number);
    bind('labels', 'labels');
    bind('flats', 'flats', Boolean, fillRootSelect);
    bind('lefty', 'lefty', Boolean);
    bind('flip', 'flip', Boolean);

    $('key-play').onclick = playProgression;
    $('scale-pos').onchange = (e) => {
      state.scalePos = e.target.value;
      // same setting as the lesson's Positions menu
      if (isLesson()) { practice.posIdx = lessonSingle() ? Number(state.scalePos) : 0; practice.order = []; practice.idx = 0; nextTarget(); }
      render();
    };
    $('pos-prev').onclick = () => stepScalePos(-1);
    $('pos-next').onclick = () => stepScalePos(1);
    $('power-btn').onclick = () => {
      state.mode = 'chord';
      state.chord = state.chord === '5' ? 'maj' : '5';
      $('mode').value = 'chord';
      $('chord').value = state.chord;
      render();
    };
    $('prev').onclick = () => { const n = voicings().length; voicingIndex = (voicingIndex - 1 + n) % n; render(); };
    $('next').onclick = () => { voicingIndex = (voicingIndex + 1) % voicings().length; render(); };
    $('play').onclick = playCurrent;
    $('tempo').oninput = (e) => { state.tempo = Number(e.target.value); syncTempo(); save(); };

    $('device').onchange = (e) => { state.device = e.target.value; save(); restartIfListening(); };
    $('channel').onchange = (e) => { state.channel = e.target.value; save(); restartIfListening(); };
    $('monitor').onchange = (e) => { state.monitor = e.target.checked; save(); input.setMonitor(state.monitor); };
    $('sensitivity').oninput = (e) => {
      state.sensitivity = Number(e.target.value);
      setThreshold();
      save();
    };
    $('refresh-devices').onclick = refreshDevices;
    $('copy-diag').onclick = copyDiagnostics;
    $('check-chord').checked = state.checkChord;
    $('check-chord').onchange = async (e) => {
      state.checkChord = e.target.checked;
      save();
      if (state.checkChord && !input.active) await startListening();
      $('chord-feedback').textContent = state.checkChord ? 'Strum the chord shown on the neck…' : '';
      $('chord-feedback').className = 'chord-feedback';
    };
    $('practice-toggle').onclick = togglePractice;
    $('lesson-play').onclick = playLessonScale;
    $('lesson-tempo').oninput = (e) => { state.tempo = Number(e.target.value); syncTempo(); save(); };
    $('lesson-pos').onchange = (e) => {
      state.scalePos = e.target.value;
      save();
      if (isLesson()) {
        practice.posIdx = lessonSingle() ? Number(state.scalePos) : 0;
        practice.order = [];
        practice.idx = 0;
        nextTarget();
        render();
        renderPractice(`Now practising position ${practice.posIdx + 1}.`, '');
      }
      render(); // the main page's Position menu shows the same choice
    };
    $('practice-type').value = state.practiceType;
    $('practice-type').onchange = (e) => {
      state.practiceType = e.target.value;
      save();
      if (practice.on) { practice.order = []; practice.idx = 0; practice.posIdx = 0; nextTarget(); }
      render();
      renderPractice();
    };
    renderPractice();
    $('listen').onclick = () => (input.active ? stopListening() : startListening());
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (tabView()) {
        if (e.code === 'Space') { e.preventDefault(); playTab(); }
        if (e.code === 'ArrowRight') { e.preventDefault(); $('tab-next').click(); }
        if (e.code === 'ArrowLeft') { e.preventDefault(); $('tab-prev').click(); }
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); playCurrent(); }
      if (state.mode === 'scale' && e.code === 'ArrowRight') { e.preventDefault(); stepScalePos(1); }
      if (state.mode === 'scale' && e.code === 'ArrowLeft') { e.preventDefault(); stepScalePos(-1); }
      if (state.mode === 'chord' && e.code === 'ArrowRight') $('next').click();
      if (state.mode === 'chord' && e.code === 'ArrowLeft') $('prev').click();
    });

    refreshDevices();
    setupUpdates();
    render();
    setupTab();
    setupMenu();
  }

  init();
})();
