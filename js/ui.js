/* ===== UI ===== */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PALETTE = ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77',
                   '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb'];
  const PAL_RGB = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const STORE_KEY = 'workbench6502.v1';

  const src = $('src'), gutter = $('gutter'), hl = $('hl'), listing = $('listing'), editorWrap = $('editorWrap');
  const msgs = $('msgs'), pill = $('status'), progSel = $('prog'), speedSel = $('speed');
  const bAsm = $('bAsm'), bStep = $('bStep'), bRun = $('bRun'), bReset = $('bReset');
  const nextEl = $('next'), lastEl = $('last'), memEl = $('mem');
  const cpu = new CPU();

  let asm = null, assembled = false, dirty = true, running = false, raf = 0, acc = 0, lastTs = 0;
  let breaks = new Set(), bpAddrs = new Set(), errLines = new Set();
  let lineByAddr = new Map(), rowByAddr = new Map(), curRow = null, hlLine = null;
  let memPage = 6, lastInfo = null, dispDirty = true, curEx = EXAMPLES[0], saveTimer = 0;
  const S0 = { a: 0, x: 0, y: 0, sp: 0, pc: 0, p: 0, valid: false };
  const loadedMask = new Uint8Array(65536);
  const frameWrites = new Set();
  let LH = 20, PT = 10;
  cpu.onWrite = a => { frameWrites.add(a); if (a >= 0x200 && a < 0x600) dispDirty = true; };

  const measure = () => {
    const cs = getComputedStyle(src);
    LH = parseFloat(cs.lineHeight) || 20; PT = parseFloat(cs.paddingTop) || 10;
  };

  /* ----- status, messages ----- */
  function setStatus(k, text) { pill.dataset.k = k; pill.textContent = text; }

  /* ----- source editor decorations ----- */
  function renderGutter() {
    const n = src.value.split('\n').length;
    let h = '';
    for (let i = 0; i < n; i++) h += `<div class="ln${breaks.has(i) ? ' bp' : ''}${errLines.has(i) ? ' err' : ''}" data-l="${i}">${i + 1}</div>`;
    gutter.innerHTML = h;
    gutter.scrollTop = src.scrollTop;
  }
  function placeHl(auto) {
    if (hlLine === null) { hl.hidden = true; return; }
    const top = PT + hlLine * LH, vh = src.clientHeight;
    if (auto && vh > 0) {
      if (top < src.scrollTop + LH) src.scrollTop = Math.max(0, top - LH * 2);
      else if (top + LH > src.scrollTop + vh - LH) src.scrollTop = top + LH * 3 - vh;
    }
    hl.style.top = (top - src.scrollTop) + 'px';
    hl.hidden = false;
  }
  function revealRow(row) {
    const top = row.offsetTop, h = row.offsetHeight, vh = listing.clientHeight;
    if (vh === 0) return;
    if (top < listing.scrollTop + h) listing.scrollTop = Math.max(0, top - h * 2);
    else if (top + h > listing.scrollTop + vh - h) listing.scrollTop = top + h * 3 - vh;
  }
  function updateMarkers() {
    const show = assembled && !dirty;
    const line = show ? lineByAddr.get(cpu.pc) : undefined;
    hlLine = line === undefined ? null : line;
    placeHl(true);
    const row = show ? (rowByAddr.get(cpu.pc) || null) : null;
    if (curRow && curRow !== row) curRow.classList.remove('cur');
    if (row) { row.classList.add('cur'); revealRow(row); }
    curRow = row;
  }

  function colorize(text) {
    const code = stripComment(text), cm = text.slice(code.length);
    const h = esc(code).replace(/^(\s*)([A-Za-z_]\w*:)?(\s*)(\.?[A-Za-z]\w*)?(.*)$/, (m, a, lb, b, mn, rest) => {
      let out = a + (lb ? `<span class="lbl">${lb}</span>` : '') + b;
      if (mn) out += `<span class="${mn[0] === '.' ? 'dir' : MN[mn.toUpperCase()] ? 'mn' : 'lbl'}">${mn}</span>`;
      return out + rest.replace(/(\$[0-9A-Fa-f]+|%[01]+|\b\d+\b)/g, '<span class="nu">$1</span>');
    });
    return h + (cm ? `<span class="cm">${esc(cm)}</span>` : '');
  }

  function buildListing() {
    rowByAddr.clear(); lineByAddr.clear(); curRow = null;
    if (!asm || !asm.ok) { listing.innerHTML = '<p class="empty">Assemble a program to see the bytes it becomes. Click a row to set a breakpoint.</p>'; return; }
    let h = '';
    for (const it of asm.items) {
      const hasA = it.addr !== null && (it.kind === 'instr' || it.kind === 'data' || it.kind === 'label' || it.kind === 'org');
      const bs = it.bytes.slice(0, 3).map(hex2).join(' ') + (it.bytes.length > 3 ? ' …' : '');
      h += `<div class="lrow${breaks.has(it.line) ? ' bp' : ''}" data-l="${it.line}"><span class="dot"></span><span class="la">${hasA ? hex4(it.addr) : ''}</span><span class="lb">${bs}</span><span class="lt">${colorize(it.text)}</span></div>`;
    }
    listing.innerHTML = h;
    const rows = listing.children;
    asm.items.forEach((it, i) => { if (it.kind === 'instr') { rowByAddr.set(it.addr, rows[i]); lineByAddr.set(it.addr, it.line); } });
  }
  function recomputeBp() {
    bpAddrs = new Set();
    if (asm && asm.ok) for (const it of asm.items) if (it.kind === 'instr' && breaks.has(it.line)) bpAddrs.add(it.addr);
  }
  function toggleBreak(l) {
    if (breaks.has(l)) breaks.delete(l); else breaks.add(l);
    recomputeBp(); renderGutter();
    const row = listing.children[l];
    if (row && row.classList.contains('lrow')) row.classList.toggle('bp', breaks.has(l));
  }

  /* ----- assemble, load, run ----- */
  function doAssemble() {
    stop(true);
    const res = assemble(src.value);
    asm = res; dirty = false; lastInfo = null; S0.valid = false;
    errLines = new Set(res.errors.map(e => e.line - 1));
    renderGutter();
    if (!res.ok) {
      assembled = false; buildListing(); recomputeBp();
      if (res.errors.length) {
        setStatus('error', `${res.errors.length} error${res.errors.length === 1 ? '' : 's'}`);
        msgs.innerHTML = res.errors.slice(0, 6).map(e => `<button type="button" class="errline" data-l="${e.line - 1}">Line ${e.line}: ${esc(e.msg)}</button>`).join('') +
          (res.errors.length > 6 ? `<div>and ${res.errors.length - 6} more</div>` : '');
      } else {
        setStatus('error', 'Nothing to run');
        msgs.textContent = 'There is no code yet. Add an instruction such as LDA #$01.';
      }
      updateMarkers(); refresh(); return false;
    }
    assembled = true; recomputeBp(); buildListing();
    loadProgram();
    msgs.innerHTML = `<span class="ok">Assembled ${res.size} byte${res.size === 1 ? '' : 's'} at $${hex4(res.lo)}–$${hex4(res.hi)}.</span> The program starts at $${hex4(res.start)}.`;
    return true;
  }
  function loadProgram() {
    stop(true);
    cpu.mem.fill(0); loadedMask.fill(0);
    for (const s of asm.segments) for (let i = 0; i < s.bytes.length; i++) { const a = (s.addr + i) & 0xFFFF; cpu.mem[a] = s.bytes[i]; loadedMask[a] = 1; }
    cpu.reset(asm.start);
    lastInfo = null; S0.valid = false; frameWrites.clear(); dispDirty = true;
    setStatus('ready', 'Ready');
    shownV.fill(-1);
    refresh();
  }
  function stepOnce() {
    S0.a = cpu.a; S0.x = cpu.x; S0.y = cpu.y; S0.sp = cpu.sp; S0.pc = cpu.pc; S0.p = cpu.getP(0); S0.valid = true;
    lastInfo = cpu.step();
  }
  function finishIfHalted() {
    if (cpu.halted) { setStatus('halted', 'Stopped'); msgs.textContent = cpu.haltReason; return true; }
    return false;
  }
  function doStep() {
    if (running) return;
    if (dirty || !assembled) { if (!doAssemble()) return; }
    if (cpu.halted) return;
    stepOnce();
    if (!finishIfHalted()) setStatus('ready', 'Ready');
    refresh();
  }
  function stop(quiet) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; running = false; bRun.textContent = 'Run';
    if (!quiet && assembled) setStatus(cpu.halted ? 'halted' : 'paused', cpu.halted ? 'Stopped' : 'Paused');
  }
  function toggleRun() {
    if (running) { stop(); refresh(); return; }
    if (dirty || !assembled) { if (!doAssemble()) return; }
    else if (cpu.halted) loadProgram();
    running = true; acc = 0; lastTs = performance.now();
    bRun.textContent = 'Pause'; setStatus('running', 'Running');
    msgs.textContent = '';
    raf = requestAnimationFrame(tick);
    refresh();
  }
  function tick(ts) {
    if (!running) return;
    const ips = speedSel.value === 'max' ? Infinity : +speedSel.value;
    const dt = Math.min(ts - lastTs, 100) / 1000; lastTs = ts;
    let n;
    if (ips === Infinity) n = Infinity; else { acc += dt * ips; n = Math.floor(acc); acc -= n; }
    const t0 = performance.now(); let c = 0, hit = false;
    while (n > 0 && !cpu.halted) {
      stepOnce(); n--; c++;
      if (bpAddrs.size && bpAddrs.has(cpu.pc)) { hit = true; break; }
      if ((c & 255) === 0 && performance.now() - t0 > 10) break;
    }
    if (cpu.halted) { stop(true); finishIfHalted(); refresh(); return; }
    if (hit) { stop(true); setStatus('paused', 'Paused'); msgs.textContent = `Breakpoint at $${hex4(cpu.pc)}.`; refresh(); return; }
    refresh();
    raf = requestAnimationFrame(tick);
  }
  function doReset() {
    if (dirty || !assembled) { doAssemble(); return; }
    loadProgram();
    msgs.textContent = `Reset. Memory cleared and the program reloaded at $${hex4(asm.start)}.`;
  }

  /* ----- CPU readout ----- */
  const REGS = [['A', 'a'], ['X', 'x'], ['Y', 'y'], ['SP', 'sp'], ['PC', 'pc']];
  const regEls = {};
  (function buildRegs() {
    const wrap = $('regs');
    for (const [k] of REGS) {
      const d = document.createElement('div');
      d.className = 'reg' + (k === 'PC' ? ' wide' : '');
      d.innerHTML = `<span class="rn">${k}</span><span class="rx"></span><span class="rs"></span><span class="rs"></span>`;
      wrap.appendChild(d);
      regEls[k] = { box: d, hex: d.children[1], s1: d.children[2], s2: d.children[3] };
    }
  })();
  const FLAGS = [['N', 7, 'Negative'], ['V', 6, 'Overflow'], ['·', 5, 'Unused, always 1'], ['B', 4, 'Break'], ['D', 3, 'Decimal mode'], ['I', 2, 'Interrupt disable'], ['Z', 1, 'Zero'], ['C', 0, 'Carry']];
  const flagEls = [];
  (function buildFlags() {
    const wrap = $('flags');
    for (const [l, , t] of FLAGS) {
      const d = document.createElement('div');
      d.className = 'flag'; d.title = t;
      d.innerHTML = `<span>${l}</span><small>0</small>`;
      wrap.appendChild(d); flagEls.push(d);
    }
  })();
  const bin8 = v => { const s = v.toString(2).padStart(8, '0'); return s.slice(0, 4) + ' ' + s.slice(4); };

  function renderRegs() {
    const vals = { A: cpu.a, X: cpu.x, Y: cpu.y, SP: cpu.sp, PC: cpu.pc };
    const old = { A: S0.a, X: S0.x, Y: S0.y, SP: S0.sp };
    for (const [k] of REGS) {
      const e = regEls[k], v = vals[k];
      e.hex.innerHTML = `<i>$</i>${k === 'PC' ? hex4(v) : hex2(v)}`;
      e.s1.textContent = String(v);
      e.s2.textContent = k === 'PC' ? 'next instruction' : k === 'SP' ? `stack at $01${hex2(v)}` : bin8(v);
      e.box.classList.toggle('chg', S0.valid && k !== 'PC' && old[k] !== v);
    }
    const P = cpu.getP(0);
    FLAGS.forEach(([, b], i) => {
      const bit = P >> b & 1, el = flagEls[i];
      el.children[1].textContent = bit;
      el.classList.toggle('on', !!bit);
      el.classList.toggle('fx', b === 5 || (b === 4 && !bit));
      el.classList.toggle('chg', S0.valid && b !== 5 && b !== 4 && ((S0.p >> b & 1) !== bit));
    });
    $('cyc').textContent = cpu.cycles.toLocaleString('en-US');
    $('cnt').textContent = cpu.instr.toLocaleString('en-US');
    $('pbyte').textContent = '$' + hex2(P);
  }
  function renderNext() {
    if (!assembled) { nextEl.innerHTML = '<span class="cap">Next instruction</span><p class="muted">Assemble a program to begin.</p>'; return; }
    if (cpu.halted) { nextEl.innerHTML = `<span class="cap">Stopped</span><p class="desc">${esc(cpu.haltReason)}</p><p class="meta">Press Reset to load the program again.</p>`; return; }
    const d = disasm(cpu.mem, cpu.pc);
    if (!d.d) { nextEl.innerHTML = `<span class="cap">Next instruction</span><p class="desc">$${hex2(cpu.mem[cpu.pc])} at $${hex4(cpu.pc)} is not an official 6502 opcode.</p>`; return; }
    const info = INFO[d.d.m], cy = d.d.cyc;
    const cyTxt = d.d.pen ? `${cy}+ cycles (+1 if it crosses a page)` : d.d.mode === 'rel' ? `${cy}+ cycles (+1 if taken)` : `${cy} cycles`;
    nextEl.innerHTML = `<span class="cap">Next instruction</span>
      <div class="ins"><span class="ad">$${hex4(cpu.pc)}</span><span class="by">${d.bytes.map(hex2).join(' ')}</span><span class="as">${esc(d.text)}</span></div>
      <p class="desc">${esc(info[0])}</p>
      <p class="meta">${MODE_NAMES[d.d.mode]} · ${d.len} byte${d.len > 1 ? 's' : ''} · ${cyTxt}${info[1] ? ' · flags ' + info[1].split('').join(' ') : ''}</p>`;
  }
  function renderLast() {
    if (!lastInfo || !lastInfo.d) { lastEl.innerHTML = '<span class="cap">Last step</span><p class="muted">Nothing has run yet. Press Step.</p>'; return; }
    const d = disasm(cpu.mem, lastInfo.pc), ch = [];
    if (S0.valid) {
      for (const [n, o, v] of [['A', S0.a, cpu.a], ['X', S0.x, cpu.x], ['Y', S0.y, cpu.y], ['SP', S0.sp, cpu.sp]])
        if (o !== v) ch.push(`${n} $${hex2(o)} → $${hex2(v)}`);
      const P = cpu.getP(0);
      for (const [b, n] of [[7, 'N'], [6, 'V'], [3, 'D'], [2, 'I'], [1, 'Z'], [0, 'C']])
        if ((S0.p >> b & 1) !== (P >> b & 1)) ch.push(`${n} ${S0.p >> b & 1} → ${P >> b & 1}`);
    }
    for (const [a, o, v] of cpu.lastWrites.slice(0, 4)) ch.push(`[$${hex4(a)}] $${hex2(o)} → $${hex2(v)}`);
    const m = lastInfo.d.m;
    if (lastInfo.d.mode === 'rel') ch.push(cpu.pc !== ((lastInfo.pc + 2) & 0xFFFF) ? `branch taken → $${hex4(cpu.pc)}` : 'branch not taken');
    else if (m === 'JMP' || m === 'JSR' || m === 'RTS' || m === 'RTI') ch.push(`PC → $${hex4(cpu.pc)}`);
    lastEl.innerHTML = `<span class="cap">Last step</span>
      <div class="ins"><span class="ad">$${hex4(lastInfo.pc)}</span><span class="by">${d.bytes.map(hex2).join(' ')}</span><span class="as">${esc(d.text)}</span><span class="ad">${lastInfo.cyc} cycles</span></div>
      <div class="deltas">${ch.length ? ch.map(c => `<span class="delta">${esc(c)}</span>`).join('') : '<span class="delta none">Nothing visible changed.</span>'}</div>`;
  }

  /* ----- memory grid and display ----- */
  const cells = [], shownV = new Int16Array(256).fill(-1), shownC = new Array(256).fill('');
  (function buildMem() {
    let h = '<div></div>';
    for (let c = 0; c < 16; c++) h += `<div class="h">${c.toString(16).toUpperCase()}</div>`;
    for (let r = 0; r < 16; r++) {
      h += `<div class="h">${hex2(r * 16)}</div>`;
      for (let c = 0; c < 16; c++) h += '<div class="m"></div>';
    }
    memEl.innerHTML = h;
    cells.push(...memEl.querySelectorAll('.m'));
  })();
  function renderMem() {
    const base = memPage << 8, spAddr = memPage === 1 ? 0x100 + cpu.sp : -1;
    for (let i = 0; i < 256; i++) {
      const a = base + i, v = cpu.mem[a], el = cells[i];
      let cls = 'm';
      if (v === 0) cls += ' z';
      if (loadedMask[a]) cls += ' p';
      if (frameWrites.has(a)) cls += ' c';
      if (assembled && a === cpu.pc) cls += ' pc';
      if (a === spAddr) cls += ' sp';
      if (shownV[i] !== v) { el.textContent = hex2(v); el.title = `$${hex4(a)} = ${v} (%${v.toString(2).padStart(8, '0')})`; shownV[i] = v; }
      if (shownC[i] !== cls) { el.className = cls; shownC[i] = cls; }
    }
  }
  function setPage(p) {
    memPage = Math.max(0, Math.min(255, p | 0));
    shownV.fill(-1);
    $('pgIn').value = hex2(memPage);
    $('pageLbl').textContent = '$' + hex2(memPage);
    document.querySelectorAll('.qb').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.page === memPage)));
    renderMem();
  }
  const sctx = $('screen').getContext('2d'), img = sctx.createImageData(32, 32);
  function drawScreen() {
    const d = img.data, m = cpu.mem;
    for (let i = 0; i < 1024; i++) {
      const c = PAL_RGB[m[0x200 + i] & 15];
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
  }
  $('swatches').innerHTML = PAL_RGB.map((c, i) => {
    const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    return `<span style="background:${PALETTE[i]};color:${lum > 0.5 ? '#000' : '#fff'}" title="Color ${i.toString(16).toUpperCase()}">${i.toString(16).toUpperCase()}</span>`;
  }).join('');

  function refresh() {
    renderRegs(); renderNext(); renderLast(); renderMem();
    if (dispDirty) { drawScreen(); dispDirty = false; }
    frameWrites.clear();
    updateMarkers();
    bStep.disabled = running || (assembled && cpu.halted);
  }

  /* ----- examples and persistence ----- */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ex: curEx.id, src: src.value })); } catch (e) {} }, 400);
  }
  function showExample(ex) {
    curEx = ex; progSel.value = ex.id;
    $('lesson').textContent = ex.note;
    speedSel.value = String(ex.speed);
    setPage(ex.page);
  }
  function loadExample(id) {
    const ex = EXAMPLES.find(e => e.id === id) || EXAMPLES[0];
    showExample(ex);
    src.value = ex.src; src.scrollTop = 0; breaks.clear();
    save(); doAssemble();
  }
  progSel.innerHTML = EXAMPLES.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  /* ----- reference ----- */
  const MODE_HELP = [
    ['Implied', 'INX', 'No operand. The instruction knows what it works on.'],
    ['Accumulator', 'ASL A', 'Works on A itself.'],
    ['Immediate', 'LDA #$10', 'The value is part of the instruction.'],
    ['Zero page', 'LDA $10', 'Address $00–$FF. Shorter and faster than absolute.'],
    ['Zero page,X / ,Y', 'LDA $10,X', 'Address plus X (or Y), wrapping inside page 0.'],
    ['Absolute', 'LDA $1234', 'Any address from $0000 to $FFFF.'],
    ['Absolute,X / ,Y', 'LDA $1234,X', 'Address plus X (or Y). One cycle more when it crosses a page.'],
    ['Indirect', 'JMP ($1234)', 'Jump to the address stored at $1234 and $1235. JMP only.'],
    ['Indexed indirect', 'LDA ($20,X)', 'The pointer sits in zero page at $20 plus X.'],
    ['Indirect indexed', 'LDA ($20),Y', 'The pointer sits at $20 and $21. Y is added to it.'],
    ['Relative', 'BNE loop', 'Branches reach 128 bytes back or 127 ahead.']
  ];
  (function buildRef() {
    const rows = MODE_HELP.map(r => `<tr><td>${r[0]}</td><td><code>${esc(r[1])}</code></td><td>${esc(r[2])}</td></tr>`).join('');
    const groups = GROUPS.map(([name, list]) => `<div><h3>${name}</h3><div class="ilist">${list.map(m =>
      `<div><b>${m}</b>${esc(INFO[m][0])}${INFO[m][1] ? ` <span class="fl">flags ${INFO[m][1].split('').join(' ')}</span>` : ''}</div>`).join('')}</div></div>`).join('');
    $('refBody').innerHTML = `
      <div><h3>Syntax</h3>
        <div class="tablewrap"><table class="reftable"><tbody>
          <tr><td>Labels and comments</td><td>A label ends with a colon and names the address of what follows: <code>loop: INX</code>. Everything after <code>;</code> is a comment.</td></tr>
          <tr><td>Numbers</td><td><code>$FF</code> hex, <code>%1010</code> binary, <code>10</code> decimal, <code>'A'</code> ASCII code.</td></tr>
          <tr><td>Expressions</td><td><code>label+1</code>, <code>&lt;label</code> for the low byte of an address, <code>&gt;label</code> for the high byte.</td></tr>
          <tr><td>Directives</td><td><code>.org $0600</code> sets the address. <code>.byte 1, 2, "text"</code> and <code>.word $1234</code> add data. <code>.res 16</code> reserves zeroed bytes.</td></tr>
          <tr><td>Constants</td><td><code>SCREEN = $0200</code></td></tr>
        </tbody></table></div></div>
      <div><h3>Addressing modes</h3><div class="tablewrap"><table class="reftable"><thead><tr><th>Mode</th><th>Example</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      ${groups}`;
  })();

  /* ----- events ----- */
  function showTab(which) {
    const s = which === 'src';
    $('tabSrc').setAttribute('aria-selected', String(s)); $('tabLst').setAttribute('aria-selected', String(!s));
    editorWrap.hidden = !s; listing.hidden = s;
    if (s) { measure(); placeHl(true); } else if (curRow) revealRow(curRow);
  }
  $('tabSrc').addEventListener('click', () => showTab('src'));
  $('tabLst').addEventListener('click', () => showTab('lst'));
  bAsm.addEventListener('click', () => { doAssemble(); });
  bStep.addEventListener('click', doStep);
  bRun.addEventListener('click', toggleRun);
  bReset.addEventListener('click', doReset);
  progSel.addEventListener('change', () => loadExample(progSel.value));
  $('restore').addEventListener('click', () => loadExample(curEx.id));

  src.addEventListener('input', () => {
    stop(true); dirty = true; hlLine = null; hl.hidden = true; errLines = new Set();
    if (curRow) { curRow.classList.remove('cur'); curRow = null; }
    setStatus('edited', 'Edited');
    renderGutter(); refresh(); save();
  });
  src.addEventListener('scroll', () => { gutter.scrollTop = src.scrollTop; placeHl(false); });
  src.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      src.setRangeText('    ', src.selectionStart, src.selectionEnd, 'end');
      src.dispatchEvent(new Event('input'));
    }
  });
  gutter.addEventListener('click', e => { const t = e.target.closest('.ln'); if (t) toggleBreak(+t.dataset.l); });
  listing.addEventListener('click', e => { const t = e.target.closest('.lrow'); if (t) toggleBreak(+t.dataset.l); });
  msgs.addEventListener('click', e => {
    const t = e.target.closest('.errline'); if (!t) return;
    const line = +t.dataset.l, lines = src.value.split('\n');
    let start = 0; for (let i = 0; i < line; i++) start += lines[i].length + 1;
    showTab('src');
    src.focus({ preventScroll: true });
    src.setSelectionRange(start, start + (lines[line] || '').length);
    src.scrollTop = Math.max(0, PT + line * LH - src.clientHeight / 2);
  });
  document.querySelectorAll('.qb').forEach(b => b.addEventListener('click', () => setPage(+b.dataset.page)));
  $('pgPrev').addEventListener('click', () => setPage(memPage - 1));
  $('pgNext').addEventListener('click', () => setPage(memPage + 1));
  $('pgIn').addEventListener('change', e => { const v = parseInt(e.target.value, 16); setPage(isNaN(v) ? memPage : v); });
  $('pgIn').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  const KEYMAP = { ArrowUp: 0x77, ArrowDown: 0x73, ArrowLeft: 0x61, ArrowRight: 0x64 };
  window.addEventListener('keydown', e => {
    const t = e.target && e.target.tagName;
    if (t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    let code = null;
    if (e.key in KEYMAP) code = KEYMAP[e.key];
    else if (e.key.length === 1 && e.key !== ' ') code = e.key.charCodeAt(0);
    if (code === null || code > 255) return;
    cpu.mem[0xFF] = code;
    if (running && e.key in KEYMAP) e.preventDefault();
  });
  document.querySelectorAll('.pad button').forEach(b => b.addEventListener('click', () => { cpu.mem[0xFF] = +b.dataset.k; }));
  window.addEventListener('resize', () => { measure(); placeHl(false); });

  /* ----- start ----- */
  measure();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
  const startEx = saved && EXAMPLES.find(e => e.id === saved.ex);
  if (startEx && typeof saved.src === 'string' && saved.src.trim()) {
    showExample(startEx);
    src.value = saved.src;
    renderGutter(); doAssemble();
  } else loadExample(EXAMPLES[0].id);
})();
