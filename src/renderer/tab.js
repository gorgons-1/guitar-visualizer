/*
 * Reads plain-text (ASCII) guitar tab into a list of steps the app can show and play.
 *
 *   e|-----0-----|        Each line is a string (top line = highest string).
 *   B|---1---1---|        Numbers are frets; "-" is time passing; "|" is a bar line.
 *   G|-2-------2-|        h p / \ b r ~ x ( ) < > are understood or ignored.
 *
 * Works in the browser (window.TabReader) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TabReader = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const TECH = { h: 'hammer-on', p: 'pull-off', '/': 'slide up', '\\': 'slide down', s: 'slide', b: 'bend', r: 'release', t: 'tap' };
  const BODY_OK = /^[-0-9|xXhpbrstPHBRSv\/\\~()<>.^*=:\[\]\s'`]+$/;

  /** Pitch class of a string label like "e", "Eb", "D#", or null. */
  function labelPc(label) {
    if (!label) return null;
    const m = /^([A-Ga-g])([#b]?)/.exec(label);
    if (!m) return null;
    let pc = NOTE_PC[m[1].toUpperCase()];
    if (m[2] === '#') pc += 1;
    if (m[2] === 'b') pc -= 1;
    return (pc + 12) % 12;
  }

  /** Splits a line into {label, body} if it looks like one string of tab, else null. */
  function tabLine(line) {
    const raw = line.replace(/\s+$/, '').replace(/[–—‒]/g, '-'); // en/em dashes from copy-paste
    let label = '', body = null;
    const m = /^\s*([A-Ga-g][#b]?)\s*(\|\||[|:)\]])(.*)$/.exec(raw);
    if (m) { label = m[1]; body = m[3]; }
    else if (/^\s*[|-]/.test(raw)) body = raw.replace(/^\s*\|?/, '');
    if (body === null) return null;
    if ((body.match(/-/g) || []).length < 2 || !BODY_OK.test(body)) return null;
    return { label, body };
  }

  const isDigit = (c) => c >= '0' && c <= '9';

  /**
   * @param {string} text  the tab
   * @returns {{systems:{labels:string[], bodies:string[]}[], events:object[], strings:number,
   *            labelPcs:(number|null)[]|null, warnings:string[]}}
   *   events[i] = {sys, col, end, bar, gap, notes:[{s, f, pitch, tech}]}
   *   s = string index from the LOW string (0); f = fret to hold; pitch = fret whose pitch sounds (bends).
   */
  function parse(text) {
    const lines = String(text || '').split(/\r?\n/);
    const systems = [];
    let cur = [];
    const flush = () => {
      if (cur.length >= 4 && cur.length <= 8) systems.push({ labels: cur.map((l) => l.label), bodies: cur.map((l) => l.body) });
      cur = [];
    };
    for (const line of lines) {
      const t = tabLine(line);
      if (t) cur.push(t);
      else flush();
    }
    flush();
    const warnings = [];
    if (!systems.length) return { systems, events: [], strings: 0, labelPcs: null, warnings: ['No tab found. Each string should be on its own line, like  e|---0---3---|'] };

    // Use the most common number of strings; skip blocks that don't match (e.g. a bass part).
    const counts = {};
    systems.forEach((s) => { counts[s.bodies.length] = (counts[s.bodies.length] || 0) + 1; });
    const strings = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0]);
    const used = systems.filter((s) => s.bodies.length === strings);
    if (used.length < systems.length) warnings.push(`Skipped ${systems.length - used.length} block(s) that didn't have ${strings} strings.`);

    const events = [];
    let bar = 0;
    used.forEach((sys, si) => {
      if (si > 0) bar++; // a new block of lines starts a new bar
      const n = strings;
      const L = Math.max(...sys.bodies.map((b) => b.length));
      const body = sys.bodies.map((b) => b.padEnd(L, '-'));
      const consumed = new Array(n).fill(0);
      const last = new Array(n).fill(null); // last {f, pitch} on each line, for bends / releases
      const readNote = (li, c) => {
        const b = body[li];
        let w = 1, val = Number(b[c]);
        if (isDigit(b[c + 1] || '') && Number(b[c] + b[c + 1]) <= 24) { w = 2; val = Number(b[c] + b[c + 1]); }
        let k = c - 1;
        while (k >= 0 && (b[k] === '(' || b[k] === '<')) k--;
        const tech = TECH[(b[k] || '').toLowerCase()] || '';
        return { w, val, tech };
      };
      let sysFirst = true;
      for (let c = 0; c < L; c++) {
        const starts = [];
        for (let li = 0; li < n; li++) if (c >= consumed[li] && isDigit(body[li][c])) starts.push(li);
        if (!starts.length) {
          const bars = body.filter((b) => b[c] === '|').length;
          if (bars >= Math.ceil(n / 2) && c > 0 && c < L - 1 && !sysFirst) bar++;
          continue;
        }
        const notes = [];
        let end = c;
        const take = (li, at) => {
          const r = readNote(li, at);
          consumed[li] = at + r.w;
          end = Math.max(end, at + r.w - 1);
          const s = n - 1 - li;
          let f = r.val, pitch = r.val;
          if (r.tech === 'bend' && last[li]) f = last[li].f; // "5b7": hold fret 5, bend up to the pitch of 7
          if (r.tech === 'release' && last[li]) f = last[li].f;
          last[li] = { f, pitch };
          notes.push({ s, f, pitch, tech: r.tech });
        };
        starts.forEach((li) => take(li, c));
        // Numbers that start inside a 2-digit fret on another line belong to the same step.
        for (let c2 = c + 1; c2 <= end; c2++) {
          for (let li = 0; li < n; li++) if (c2 >= consumed[li] && isDigit(body[li][c2])) take(li, c2);
        }
        notes.sort((a, b) => a.s - b.s);
        events.push({ sys: si, col: c, end, bar, gap: 0, notes });
        sysFirst = false;
        c = end;
      }
      // time to the end of the block, for the last step
      const lastEv = events[events.length - 1];
      if (lastEv && lastEv.sys === si) lastEv.gap = Math.max(2, L - lastEv.col);
    });
    for (let i = 0; i < events.length - 1; i++) {
      if (events[i + 1].sys === events[i].sys) events[i].gap = events[i + 1].col - events[i].col;
    }
    if (!events.length) warnings.push('Found tab lines but no fret numbers.');

    const labelSets = used.map((s) => s.labels.map(labelPc));
    const labelPcs = labelSets.find((l) => l.every((x) => x !== null));
    return {
      systems: used, events, strings,
      labelPcs: labelPcs ? labelPcs.slice().reverse() : null, // low -> high
      warnings,
    };
  }

  /** Id of a tuning (from the given table) that matches the tab's string labels / string count. */
  function matchTuning(song, tunings, currentId) {
    const fits = (id) => tunings[id].notes.length === song.strings;
    if (song.labelPcs) {
      const hit = Object.keys(tunings).filter(fits)
        .filter((id) => tunings[id].notes.every((m, i) => m % 12 === song.labelPcs[i]));
      if (hit.includes(currentId)) return currentId;
      if (hit.length) return hit[0];
    }
    if (tunings[currentId] && fits(currentId)) return currentId;
    return Object.keys(tunings).find(fits) || null;
  }

  return { parse, matchTuning, labelPc };
});
