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
    device: '', channel: 'mix', monitor: false, sensitivity: 60, showAllLive: false, guitarOnly: true,
  };
  const state = (() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('gv-state') || '{}') }; } catch { return { ...DEFAULTS }; }
  })();
  if (!T.TUNINGS[state.tuning]) state.tuning = DEFAULTS.tuning;
  if (!T.SCALES[state.scale]) state.scale = DEFAULTS.scale;
  if (!T.CHORDS[state.chord]) state.chord = DEFAULTS.chord;
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
    if (liveMidi !== null) {
      const list = state.showAllLive ? positionsOf(liveMidi) : livePos ? [livePos] : [];
      list.forEach((p) => mark(p, 'live'));
    }
  }

  const positionsOf = (midi) => T.positionsOf(tuning(), state.frets, midi);
  const bestPosition = (midi, hand) => T.guessPosition(tuning(), state.frets, midi, hand);

  // ---------------- Side panel ----------------
  function renderInfo() {
    const isScale = state.mode === 'scale';
    $('scale-wrap').classList.toggle('hidden', !isScale);
    $('chord-wrap').classList.toggle('hidden', isScale);
    $('voicing-nav').classList.toggle('hidden', state.mode !== 'chord');

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
    if (!note) {
      if (liveMidi !== null) clearDetected();
      return;
    }
    if (note.midi !== liveMidi) {
      liveMidi = note.midi;
      const hand = now - handTime < 2000 ? handPos : null; // forget the hand after a 2 s pause
      livePos = bestPosition(liveMidi, hand);
      if (livePos && livePos.f > 0) handPos = livePos; // open strings don't move the hand
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
    bind('frets', 'frets', Number);
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
