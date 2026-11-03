(() => {
  'use strict';
  const T = window.Theory;
  const { Synth, LiveInput } = window.GVAudio;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------- State ----------------
  const DEFAULTS = {
    mode: 'scale', root: 9, scale: 'minorPentatonic', chord: 'maj', tuning: 'standard',
    frets: 15, labels: 'notes', flats: false, lefty: false, tempo: 120,
    device: '', channel: 'mix', monitor: false, sensitivity: 60, showAllLive: false, guitarOnly: true, handLock: '',
    practiceType: 'find', useStrings: false, calib: {}, checkChord: false,
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
      voicingCache = { key, list: T.findVoicings(tuning(), state.root, state.chord, { maxFret: state.frets }) };
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
    const H = top * 2 + gap * (n - 1) + 22;
    const openX = 26, nutX = 56, endX = W - 14;
    const k = 1 - Math.pow(2, -N / 12);
    const fx = (f) => nutX + ((endX - nutX) * (1 - Math.pow(2, -f / 12))) / k;
    const X = (x) => (state.lefty ? W - x : x);
    const sy = (s) => top + (n - 1 - s) * gap; // high string on top
    const noteX = (f) => (f === 0 ? openX : (fx(f - 1) + fx(f)) / 2);
    geom = { X, sy, noteX };

    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const boardTop = sy(n - 1) - 14, boardBot = sy(0) + 14;
    const rect = (x1, x2, y, h, cls) =>
      el('rect', { x: Math.min(X(x1), X(x2)), y, width: Math.abs(X(x2) - X(x1)), height: h, class: cls }, svg);

    rect(nutX, endX, boardTop, boardBot - boardTop, 'board');

    // Inlays
    const midY = (boardTop + boardBot) / 2;
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      if (f > N) continue;
      const cx = X(noteX(f));
      if (f % 12 === 0) {
        el('circle', { cx, cy: midY - gap, r: 6, class: 'inlay' }, svg);
        el('circle', { cx, cy: midY + gap, r: 6, class: 'inlay' }, svg);
      } else {
        el('circle', { cx, cy: midY, r: 6, class: 'inlay' }, svg);
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
      const t = el('text', { x: X(noteX(f)), y: boardBot + 16, class: 'fretnum' }, svg);
      t.textContent = f;
    }

    // Locked hand-position area
    if (areaStart() !== null) {
      const lo = areaStart(), hi = Math.min(N, lo + 4);
      const x1 = lo === 0 ? openX - 16 : fx(lo - 1), x2 = fx(hi);
      rect(x1, x2, boardTop - 6, boardBot - boardTop + 12, 'hand-area');
    }

    // Notes
    const pcs = activePcs();
    const pcSet = new Set(pcs);
    const voicing = state.mode === 'chord' ? currentVoicing() : null;

    for (let s = 0; s < n; s++) {
      if (voicing && voicing[s] === null) {
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

        if (!pcSet.has(p)) continue;
        if (voicing && voicing[s] === null && f === 0) continue; // keep the × readable
        let ghost = false;
        if (state.mode === 'chord') {
          if (!voicing) ghost = true;
          else if (voicing[s] !== f) ghost = true;
        }
        const semis = T.pc(p - state.root);
        el('circle', { cx, cy, r: 12, class: 'dot' + (ghost ? ' ghost' : ''), fill: colorFor(semis) }, svg);
        if (!ghost && state.labels !== 'none') {
          const t = el('text', { x: cx, y: cy, class: 'dot-label' }, svg);
          t.textContent = state.labels === 'intervals' ? T.INTERVALS[semis] : name(p);
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
    const target = cal.active ? { s: cal.s, f: 0 } : practice.on ? practice.target : null;
    if (practice.on && state.practiceType === 'lesson') {
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
    if (liveMidi !== null) {
      const list = state.showAllLive ? positionsOf(liveMidi) : livePos ? [livePos] : [];
      list.forEach((p) => mark(p, 'live'));
    }
  }

  const positionsOf = (midi) => T.positionsOf(tuning(), state.frets, midi);
  const handLock = () => (state.handLock === '' || state.handLock === undefined ? null : Number(state.handLock));
  const bestPosition = (midi, hand) => T.guessPosition(tuning(), state.frets, midi, hand, handLock());

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
      chip.innerHTML = `${name(p)}<small>${T.INTERVALS[semis]}</small>`;
      list.appendChild(chip);
    }

    if (state.mode === 'chord') {
      const all = voicings();
      const v = currentVoicing();
      $('voicing-label').textContent = v ? `${voicingIndex + 1}/${all.length}:  ${T.formatVoicing(v)}` : 'No voicing found';
      $('prev').disabled = $('next').disabled = all.length < 2;
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
    if (typeof updateStringsUi === 'function') updateStringsUi();
    // Scale, chord, tuning or Hand position changed: keep practice targets inside the new notes/area.
    if (practice.on && state.practiceType === 'lesson') {
      const lock = handLock();
      const want = lock !== null ? lock : T.defaultPosition(tuning(), state.root);
      const order = T.scaleLesson(tuning(), activePcs(), want + 4 > state.frets ? 0 : want);
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
    const seq = state.mode === 'scale'
      ? T.buildRun(tuning(), state.root, activePcs(), 1)
      : T.buildRun(tuning(), state.root, activePcs(), 2);
    const step = beat / 2; // eighth notes
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

  // ---------------- String detection (experimental) ----------------
  const stringLabel = (s) => `${T.noteName(tuning()[s], state.flats)} string (${tuning().length - s})`;
  const calibration = () => (state.calib && state.calib[state.tuning]) || null;
  const cal = { active: false, s: 0, samples: [], result: [], lastMeasure: 0, since: 0 };
  let noteOnAt = 0; // when the current note started (new pitch or re-pluck)
  let lastOnset = -Infinity;
  let measuredFor = -1;
  const timbreLog = [];

  function updateStringsUi() {
    const c = calibration();
    $('use-strings').disabled = !c;
    $('use-strings').checked = !!(c && state.useStrings);
    $('calibrate').textContent = cal.active ? 'Cancel' : c ? 'Re-calibrate' : 'Calibrate';
    if (!cal.active) {
      $('calib-status').textContent = c
        ? `Calibrated for ${T.TUNINGS[state.tuning].name}.`
        : `Not calibrated for ${T.TUNINGS[state.tuning].name} yet.`;
    }
  }

  async function toggleCalibration() {
    if (cal.active) {
      cal.active = false;
      updateStringsUi();
      drawOverlay();
      return;
    }
    if (!input.active) await startListening();
    if (!input.active) return;
    Object.assign(cal, { active: true, s: 0, samples: [], result: [], lastMeasure: 0, since: performance.now() });
    calPrompt();
    updateStringsUi();
    drawOverlay();
  }

  function calPrompt(extra = '') {
    $('calib-status').textContent =
      `${extra}Pluck the open ${stringLabel(cal.s)} and let it ring (${cal.s + 1} of ${tuning().length}).`;
  }

  function calibrationStep(frame, note, now) {
    const want = tuning()[cal.s];
    if (!note) return;
    if (note.midi !== want) {
      // Only complain about a newly plucked wrong note (the last string may still be ringing).
      if (noteOnAt > cal.since && now - noteOnAt > 150) calPrompt(`Heard ${T.noteNameWithOctave(note.midi, state.flats)}. `);
      return;
    }
    const age = now - noteOnAt;
    if (age < 120 || age > 1500 || now - cal.lastMeasure < 110) return;
    cal.lastMeasure = now;
    const r = window.Timbre.measure(frame.long.slice(), frame.sampleRate, note.freq);
    if (r) cal.samples.push(r.B);
    else if (age > 1200 && cal.samples.length === 0) {
      calPrompt("Couldn't read that one clearly - pluck a bit harder. ");
      return;
    }
    if (cal.samples.length < 3) return;
    const sorted = [...cal.samples].sort((a, b) => a - b);
    cal.result[cal.s] = sorted[1];
    cal.samples = [];
    cal.s++;
    cal.since = now;
    if (cal.s >= tuning().length) {
      state.calib = { ...(state.calib || {}), [state.tuning]: cal.result.slice() };
      state.useStrings = true;
      cal.active = false;
      save();
      updateStringsUi();
      $('calib-status').textContent = 'Calibration done! String detection is on.';
    } else {
      calPrompt('Got it. ');
    }
    drawOverlay();
  }

  /** After a note has rung ~120 ms, measure its timbre and pick the string. */
  function detectString(frame, note, now) {
    const c = calibration();
    if (!state.useStrings || !c || cal.active || measuredFor === noteOnAt) return;
    const age = now - noteOnAt;
    if (age < 120 || age > 800) return;
    measuredFor = noteOnAt;
    const cands = positionsOf(note.midi);
    if (cands.length < 2) { $('string-guess').textContent = ''; return; }
    if (practice.on && practice.target && note.midi === practice.target.midi) return; // target position is known
    const r = window.Timbre.measure(frame.long.slice(), frame.sampleRate, note.freq);
    if (!r) { $('string-guess').textContent = 'String: couldn\'t measure this note'; return; }
    const lock = handLock();
    const prior = (p) => {
      if (lock === null) return 0;
      const outside = p.f < lock ? lock - p.f : p.f > lock + 4 ? p.f - lock - 4 : 0;
      return outside * 1.5;
    };
    const res = window.Timbre.classify(cands, r.B, c, prior);
    const pct = Math.round(res.confidence * 100);
    timbreLog.push({ t: Math.round(now), midi: note.midi, B: r.B, partials: r.partials, best: res.best, pct });
    if (timbreLog.length > 12) timbreLog.shift();
    if (res.confidence >= 0.6) {
      livePos = res.best;
      if (livePos.f > 0) handPos = livePos;
      $('string-guess').textContent = `String: ${stringLabel(res.best.s)}, fret ${res.best.f} (${pct}% sure)`;
      drawOverlay();
    } else {
      $('string-guess').textContent = `String: not sure (best guess ${stringLabel(res.best.s)}, ${pct}%)`;
    }
  }

  // ---------------- Practice mode & lessons ----------------
  const practice = {
    on: false, target: null, order: [], idx: 0, shownAt: 0, startedAt: 0, lessonStart: 0,
    right: 0, wrong: 0, streak: 0, best: 0, times: [], lastWrongAt: 0,
  };
  const isLesson = () => practice.on && state.practiceType === 'lesson';
  /** Start fret of the shaded area: the Hand position lock, or the running lesson's position. */
  function areaStart() {
    if (handLock() !== null) return handLock();
    return isLesson() ? practice.lessonStart : null;
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
    const lock = handLock();
    practice.lessonStart = lock !== null ? lock : T.defaultPosition(tuning(), state.root);
    if (practice.lessonStart + 4 > state.frets) practice.lessonStart = 0;
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
      head = 'No notes in this area — change the scale or Hand position';
    }
    $('practice-target').textContent = head;
    $('lesson-info').textContent = isLesson()
      ? `${$('title').textContent.split(' — ')[0]}, frets ${practice.lessonStart}–${practice.lessonStart + 4}. Play each note in turn — the green circle is next, then 2, 3, 4.`
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
    Object.assign(practice, { on: true, target: null, order: [], idx: 0, right: 0, wrong: 0, streak: 0, best: 0, times: [] });
    nextTarget();
    render(); // shade the lesson's area
    renderPractice(state.practiceType === 'lesson' ? 'Start with note 1 (green circle).' : 'Go!', '');
  }

  function finishLesson(now) {
    const secs = Math.round((now - practice.startedAt) / 1000);
    const notes = practice.order.length;
    practice.on = false;
    practice.target = null;
    renderPractice(`🎉 Lesson complete! ${notes} notes in ${secs} s with ${practice.wrong} mistake${practice.wrong === 1 ? '' : 's'}. Press Start lesson to go again.`, 'yes');
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
      const hint = mistakeText(res.mistake, shape || []);
      box.textContent = `✗ Not quite: ${parts.join('; ')}. ${hint}`.trim();
      box.className = 'chord-feedback no';
    }
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
      `calibration=${JSON.stringify((calibration() || []).map((b) => +b.toExponential(2)))} useStrings=${state.useStrings} handLock=${state.handLock || 'auto'}`,
      ...chordLog.map((c) => `chord t=${c.t - t0} ${c.status} missing=${c.missing.map((p) => T.SHARPS[p]).join(',')} extra=${c.extra.map((p) => T.SHARPS[p]).join(',')} hint=${c.mistake ? c.mistake.kind + ':' + c.mistake.s + (c.mistake.fret !== undefined ? ':' + c.mistake.fret : '') : '-'} profile=${c.profile.map((v) => v.toFixed(2)).join(' ')}`),
      ...timbreLog.map((m) => `timbre t=${m.t - t0} note=${T.noteNameWithOctave(m.midi)} B=${m.B.toExponential(2)} partials=${m.partials} -> ${stringLabel(m.best.s)} fret ${m.best.f} (${m.pct}%)`),
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
      livePos = lessonPosition(liveMidi) || bestPosition(liveMidi, hand);
      if (livePos && livePos.f > 0) handPos = livePos; // open strings don't move the hand
      if (state.useStrings && calibration()) $('string-guess').textContent = '';
      practiceNoteOn(liveMidi, now);
      drawOverlay();
    }
    handTime = now;
    if (cal.active) calibrationStep(frame, note, now);
    else detectString(frame, note, now);
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
  function fillHandLock() {
    const entries = [['', 'Auto (guess)']];
    for (let f = 0; f + 4 <= state.frets; f++) entries.push([String(f), f === 0 ? 'Frets 0–4 (open position)' : `Frets ${f}–${f + 4}`]);
    if (handLock() !== null && handLock() + 4 > state.frets) state.handLock = '';
    fillSelect($('hand-lock'), entries, state.handLock);
  }

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
    $('tempo').value = state.tempo;
    $('tempo-val').textContent = state.tempo;
    $('channel').value = state.channel;
    $('monitor').checked = state.monitor;
    $('guitar-only').checked = state.guitarOnly;
    $('guitar-only').onchange = (e) => { state.guitarOnly = gate.guitarOnly = e.target.checked; save(); gate.reset(); clearDetected(); };
    fillHandLock();
    $('hand-lock').onchange = (e) => {
      state.handLock = e.target.value;
      if (liveMidi !== null) livePos = bestPosition(liveMidi, handPos);
      render();
    };
    $('show-all-live').checked = state.showAllLive;
    $('show-all-live').onchange = (e) => { state.showAllLive = e.target.checked; save(); drawOverlay(); };
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
    bind('frets', 'frets', Number, () => fillHandLock());
    bind('labels', 'labels');
    bind('flats', 'flats', Boolean, fillRootSelect);
    bind('lefty', 'lefty', Boolean);

    $('prev').onclick = () => { const n = voicings().length; voicingIndex = (voicingIndex - 1 + n) % n; render(); };
    $('next').onclick = () => { voicingIndex = (voicingIndex + 1) % voicings().length; render(); };
    $('play').onclick = playCurrent;
    $('tempo').oninput = (e) => { state.tempo = Number(e.target.value); $('tempo-val').textContent = state.tempo; save(); };

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
    $('calibrate').onclick = toggleCalibration;
    $('check-chord').checked = state.checkChord;
    $('check-chord').onchange = async (e) => {
      state.checkChord = e.target.checked;
      save();
      if (state.checkChord && !input.active) await startListening();
      $('chord-feedback').textContent = state.checkChord ? 'Strum the chord shown on the neck…' : '';
      $('chord-feedback').className = 'chord-feedback';
    };
    $('use-strings').onchange = (e) => { state.useStrings = e.target.checked; save(); };
    $('practice-toggle').onclick = togglePractice;
    $('practice-type').value = state.practiceType;
    $('practice-type').onchange = (e) => {
      state.practiceType = e.target.value;
      save();
      if (practice.on) { practice.order = []; practice.idx = 0; nextTarget(); render(); }
      renderPractice();
    };
    updateStringsUi();
    renderPractice();
    $('listen').onclick = () => (input.active ? stopListening() : startListening());
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); playCurrent(); }
      if (state.mode === 'chord' && e.code === 'ArrowRight') $('next').click();
      if (state.mode === 'chord' && e.code === 'ArrowLeft') $('prev').click();
    });

    refreshDevices();
    setupUpdates();
    render();
  }

  init();
})();
