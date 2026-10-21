'use strict';
/* ===== 6502 core: opcode table, assembler, CPU ===== */
const hex2 = v => (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const hex4 = v => (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

// mnemonic, then "mode opcode cycles" parts. A trailing p means +1 cycle when a page boundary is crossed.
const SPEC = `
ADC imm 69 2|zp 65 3|zpx 75 4|abs 6D 4|abx 7D 4p|aby 79 4p|izx 61 6|izy 71 5p
AND imm 29 2|zp 25 3|zpx 35 4|abs 2D 4|abx 3D 4p|aby 39 4p|izx 21 6|izy 31 5p
ASL acc 0A 2|zp 06 5|zpx 16 6|abs 0E 6|abx 1E 7
BCC rel 90 2
BCS rel B0 2
BEQ rel F0 2
BIT zp 24 3|abs 2C 4
BMI rel 30 2
BNE rel D0 2
BPL rel 10 2
BRK imp 00 7
BVC rel 50 2
BVS rel 70 2
CLC imp 18 2
CLD imp D8 2
CLI imp 58 2
CLV imp B8 2
CMP imm C9 2|zp C5 3|zpx D5 4|abs CD 4|abx DD 4p|aby D9 4p|izx C1 6|izy D1 5p
CPX imm E0 2|zp E4 3|abs EC 4
CPY imm C0 2|zp C4 3|abs CC 4
DEC zp C6 5|zpx D6 6|abs CE 6|abx DE 7
DEX imp CA 2
DEY imp 88 2
EOR imm 49 2|zp 45 3|zpx 55 4|abs 4D 4|abx 5D 4p|aby 59 4p|izx 41 6|izy 51 5p
INC zp E6 5|zpx F6 6|abs EE 6|abx FE 7
INX imp E8 2
INY imp C8 2
JMP abs 4C 3|ind 6C 5
JSR abs 20 6
LDA imm A9 2|zp A5 3|zpx B5 4|abs AD 4|abx BD 4p|aby B9 4p|izx A1 6|izy B1 5p
LDX imm A2 2|zp A6 3|zpy B6 4|abs AE 4|aby BE 4p
LDY imm A0 2|zp A4 3|zpx B4 4|abs AC 4|abx BC 4p
LSR acc 4A 2|zp 46 5|zpx 56 6|abs 4E 6|abx 5E 7
NOP imp EA 2
ORA imm 09 2|zp 05 3|zpx 15 4|abs 0D 4|abx 1D 4p|aby 19 4p|izx 01 6|izy 11 5p
PHA imp 48 3
PHP imp 08 3
PLA imp 68 4
PLP imp 28 4
ROL acc 2A 2|zp 26 5|zpx 36 6|abs 2E 6|abx 3E 7
ROR acc 6A 2|zp 66 5|zpx 76 6|abs 6E 6|abx 7E 7
RTI imp 40 6
RTS imp 60 6
SBC imm E9 2|zp E5 3|zpx F5 4|abs ED 4|abx FD 4p|aby F9 4p|izx E1 6|izy F1 5p
SEC imp 38 2
SED imp F8 2
SEI imp 78 2
STA zp 85 3|zpx 95 4|abs 8D 4|abx 9D 5|aby 99 5|izx 81 6|izy 91 6
STX zp 86 3|zpy 96 4|abs 8E 4
STY zp 84 3|zpx 94 4|abs 8C 4
TAX imp AA 2
TAY imp A8 2
TSX imp BA 2
TXA imp 8A 2
TXS imp 9A 2
TYA imp 98 2
`;
const MODE_LEN = { imp:1, acc:1, imm:2, zp:2, zpx:2, zpy:2, izx:2, izy:2, rel:2, abs:3, abx:3, aby:3, ind:3 };
const MODE_NAMES = { imp:'implied', acc:'accumulator', imm:'immediate', zp:'zero page', zpx:'zero page,X', zpy:'zero page,Y',
  abs:'absolute', abx:'absolute,X', aby:'absolute,Y', ind:'indirect', izx:'indexed indirect', izy:'indirect indexed', rel:'relative' };
const MN = {};                          // mnemonic -> { mode: {op, cyc, pen} }
const OPS = new Array(256).fill(null);  // opcode -> { m, mode, len, cyc, pen }
for (const line of SPEC.trim().split('\n')) {
  const sp = line.indexOf(' ');
  const m = line.slice(0, sp);
  MN[m] = {};
  for (const part of line.slice(sp + 1).split('|')) {
    const [mode, hex, c] = part.trim().split(/\s+/);
    const op = parseInt(hex, 16), pen = c.endsWith('p'), cyc = parseInt(c, 10);
    MN[m][mode] = { op, cyc, pen };
    OPS[op] = { m, mode, len: MODE_LEN[mode], cyc, pen };
  }
}

const INFO = {
  LDA:['Load a value into the accumulator (A).','NZ'], LDX:['Load a value into X.','NZ'], LDY:['Load a value into Y.','NZ'],
  STA:['Store A into memory.',''], STX:['Store X into memory.',''], STY:['Store Y into memory.',''],
  TAX:['Copy A into X.','NZ'], TAY:['Copy A into Y.','NZ'], TXA:['Copy X into A.','NZ'], TYA:['Copy Y into A.','NZ'],
  TSX:['Copy the stack pointer into X.','NZ'], TXS:['Copy X into the stack pointer.',''],
  PHA:['Push A onto the stack. SP goes down by one.',''], PHP:['Push the status flags onto the stack.',''],
  PLA:['Pull the top byte of the stack into A. SP goes up by one.','NZ'], PLP:['Pull the status flags from the stack.','NVDIZC'],
  AND:['AND each bit of A with a memory value.','NZ'], ORA:['OR each bit of A with a memory value.','NZ'], EOR:['XOR each bit of A with a memory value.','NZ'],
  BIT:['Test bits. Z shows whether A AND memory is zero. N and V copy bits 7 and 6 of the memory byte.','NVZ'],
  ADC:['Add a value and the carry flag to A. Clear carry first with CLC for a plain addition.','NVZC'],
  SBC:['Subtract a value and the borrow (the inverted carry) from A. Set carry first with SEC for a plain subtraction.','NVZC'],
  CMP:['Compare A with a value by subtracting it and discarding the result. C means A is greater or equal, Z means equal.','NZC'],
  CPX:['Compare X with a value. C means X is greater or equal, Z means equal.','NZC'],
  CPY:['Compare Y with a value. C means Y is greater or equal, Z means equal.','NZC'],
  INC:['Add 1 to a memory byte.','NZ'], DEC:['Subtract 1 from a memory byte.','NZ'],
  INX:['Add 1 to X.','NZ'], INY:['Add 1 to Y.','NZ'], DEX:['Subtract 1 from X.','NZ'], DEY:['Subtract 1 from Y.','NZ'],
  ASL:['Shift left. Bit 7 goes into C and a 0 enters bit 0. Doubles the value.','NZC'],
  LSR:['Shift right. Bit 0 goes into C and a 0 enters bit 7. Halves the value.','NZC'],
  ROL:['Rotate left through carry. The old C enters bit 0 and bit 7 becomes the new C.','NZC'],
  ROR:['Rotate right through carry. The old C enters bit 7 and bit 0 becomes the new C.','NZC'],
  JMP:['Jump to a new address and keep going from there.',''],
  JSR:['Jump to a subroutine. The return address is pushed on the stack first.',''],
  RTS:['Return from a subroutine. Pulls the return address and continues after the JSR.',''],
  RTI:['Return from an interrupt. Pulls the flags, then the return address.','NVDIZC'],
  BRK:['Break. Real hardware starts an interrupt. Here it stops the program.',''],
  BCC:['Branch if carry is clear (C = 0).',''], BCS:['Branch if carry is set (C = 1).',''],
  BEQ:['Branch if equal, meaning Z = 1.',''], BNE:['Branch if not equal, meaning Z = 0.',''],
  BMI:['Branch if minus, meaning N = 1.',''], BPL:['Branch if plus, meaning N = 0.',''],
  BVC:['Branch if overflow is clear (V = 0).',''], BVS:['Branch if overflow is set (V = 1).',''],
  CLC:['Clear the carry flag.','C'], SEC:['Set the carry flag.','C'],
  CLD:['Clear decimal mode. ADC and SBC use plain binary.','D'], SED:['Set decimal mode. ADC and SBC use BCD.','D'],
  CLI:['Clear interrupt disable.','I'], SEI:['Set interrupt disable.','I'], CLV:['Clear the overflow flag.','V'],
  NOP:['Do nothing for two cycles.','']
};
const GROUPS = [
  ['Load and store', ['LDA','LDX','LDY','STA','STX','STY']],
  ['Transfer', ['TAX','TAY','TXA','TYA','TSX','TXS']],
  ['Stack', ['PHA','PHP','PLA','PLP']],
  ['Logic', ['AND','ORA','EOR','BIT']],
  ['Arithmetic and compare', ['ADC','SBC','CMP','CPX','CPY']],
  ['Increment and decrement', ['INC','DEC','INX','INY','DEX','DEY']],
  ['Shifts', ['ASL','LSR','ROL','ROR']],
  ['Jumps and calls', ['JMP','JSR','RTS','RTI','BRK']],
  ['Branches', ['BCC','BCS','BEQ','BNE','BMI','BPL','BVC','BVS']],
  ['Flags and misc', ['CLC','SEC','CLD','SED','CLI','SEI','CLV','NOP']]
];

/* ---------- assembler ---------- */
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ';') return s.slice(0, i);
  }
  return s;
}
function splitArgs(s) {
  const out = []; let cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === '\\' && i + 1 < s.length) cur += s[++i]; else if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim());
  return out;
}
function unescapeStr(body) {
  const o = [];
  for (let i = 0; i < body.length; i++) {
    let c = body[i];
    if (c === '\\' && i + 1 < body.length) { const n = body[++i]; c = n === 'n' ? '\n' : n === 't' ? '\t' : n === '0' ? '\0' : n; }
    o.push(c.charCodeAt(0) & 0xFF);
  }
  return o;
}
const TOK = /\s*([+\-]|\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|%[01]+|\d+|'(?:\\.|[^'])'|\*|[A-Za-z_]\w*)/y;
function evalExpr(str, st) {
  let s = str.trim();
  if (!s) throw new Error('a value is missing');
  let part = null;
  if (s[0] === '<' || s[0] === '>') { part = s[0]; s = s.slice(1).trim(); }
  const toks = []; let pos = 0;
  for (;;) { TOK.lastIndex = pos; const m = TOK.exec(s); if (!m) break; toks.push(m[1]); pos = TOK.lastIndex; }
  if (s.slice(pos).trim() !== '' || !toks.length) throw new Error(`can't understand "${str.trim()}"`);
  let total = 0, sign = 1, want = true, unresolved = false;
  for (const t of toks) {
    if (t === '+' || t === '-') {
      if (want) { if (t === '-') sign = -sign; } else { sign = t === '-' ? -1 : 1; want = true; }
      continue;
    }
    if (!want) throw new Error(`can't understand "${str.trim()}"`);
    let v;
    if (t[0] === '$') v = parseInt(t.slice(1), 16);
    else if (t.startsWith('0x')) v = parseInt(t, 16);
    else if (t[0] === '%') v = parseInt(t.slice(1), 2);
    else if (/^\d/.test(t)) v = parseInt(t, 10);
    else if (t[0] === "'") v = unescapeStr(t.slice(1, -1))[0];
    else if (t === '*') v = st.pc;
    else {
      const k = t.toUpperCase();
      if (k in st.syms) v = st.syms[k];
      else if (st.pass === 1) { v = 0; unresolved = true; }
      else throw new Error(`unknown label "${t}"`);
    }
    total += sign * v; sign = 1; want = false;
  }
  if (want) throw new Error(`"${str.trim()}" ends too early`);
  if (part === '<') total = total & 0xFF;
  else if (part === '>') total = (total >> 8) & 0xFF;
  return { v: total, unresolved };
}
function parseOperand(op) {
  op = op.trim(); let m;
  if (!op) return { kind: 'imp' };
  if (/^a$/i.test(op)) return { kind: 'acc' };
  if (op[0] === '#') return { kind: 'imm', expr: op.slice(1) };
  if ((m = op.match(/^\(\s*(.+?)\s*,\s*x\s*\)$/i))) return { kind: 'izx', expr: m[1] };
  if ((m = op.match(/^\(\s*(.+?)\s*\)\s*,\s*y$/i))) return { kind: 'izy', expr: m[1] };
  if ((m = op.match(/^\(\s*(.+)\s*\)$/))) return { kind: 'ind', expr: m[1] };
  if ((m = op.match(/^(.+?)\s*,\s*x$/i))) return { kind: 'mx', expr: m[1] };
  if ((m = op.match(/^(.+?)\s*,\s*y$/i))) return { kind: 'my', expr: m[1] };
  return { kind: 'mem', expr: op };
}
function pickMode(mn, po, ctx) {
  const t = MN[mn];
  const has = k => k in t;
  const need = k => { if (!has(k)) throw new Error(`${mn} has no ${MODE_NAMES[k]} mode`); return { mode: k, expr: po.expr }; };
  const choose = (zp, ab) => {
    if (has(zp) && !has(ab)) return zp;
    if (has(ab) && !has(zp)) return ab;
    const r = evalExpr(po.expr, ctx);
    return (!r.unresolved && r.v >= 0 && r.v < 256) ? zp : ab;
  };
  switch (po.kind) {
    case 'imp':
      if (has('imp')) return { mode: 'imp' };
      if (has('acc')) return { mode: 'acc' };
      throw new Error(`${mn} needs an operand`);
    case 'acc': return need('acc');
    case 'imm': return need('imm');
    case 'izx': return need('izx');
    case 'izy': return need('izy');
    case 'ind': return need('ind');
    case 'mx': case 'my': {
      const zp = po.kind === 'mx' ? 'zpx' : 'zpy', ab = po.kind === 'mx' ? 'abx' : 'aby';
      if (!has(zp) && !has(ab)) throw new Error(`${mn} can't be indexed with ${po.kind === 'mx' ? 'X' : 'Y'}`);
      return { mode: choose(zp, ab), expr: po.expr };
    }
    default:
      if (has('rel')) return { mode: 'rel', expr: po.expr };
      if (!has('zp') && !has('abs')) throw new Error(`${mn} doesn't take an address`);
      return { mode: choose('zp', 'abs'), expr: po.expr };
  }
}
function dataSize(item) {
  if (item.dir === 'word') return item.args.length * 2;
  let n = 0;
  for (const a of item.args) { const m = a.match(/^"(.*)"$/s); n += m ? unescapeStr(m[1]).length : 1; }
  return n + (item.zero ? 1 : 0);
}

function assemble(src) {
  const lines = src.split(/\r?\n/);
  const errors = [], syms = Object.create(null), items = [];
  let pc = 0x0600;
  const checkAddr = v => { if (v < 0 || v > 0xFFFF) throw new Error(`address $${v.toString(16).toUpperCase()} is outside $0000-$FFFF`); };

  lines.forEach((raw, li) => {
    const item = { line: li, text: raw, kind: 'blank', addr: null, bytes: [] };
    items.push(item);
    try {
      const s = stripComment(raw), t = s.trim();
      if (!t) return;
      let m;
      if ((m = t.match(/^\*\s*=\s*(.+)$/))) {
        const r = evalExpr(m[1], { syms, pc, pass: 1 });
        if (r.unresolved) throw new Error('the origin must use values defined earlier');
        checkAddr(r.v); pc = r.v; item.kind = 'org'; item.addr = pc; return;
      }
      if ((m = t.match(/^([A-Za-z_]\w*)\s*(?:=|\.?equ\b)\s*(.+)$/i)) || (m = t.match(/^define\s+([A-Za-z_]\w*)\s+(.+)$/i))) {
        const r = evalExpr(m[2], { syms, pc, pass: 1 });
        if (r.unresolved) throw new Error(`"${m[1]}" must be set from values defined earlier`);
        const k = m[1].toUpperCase();
        if (k in syms) throw new Error(`"${m[1]}" is already defined`);
        syms[k] = r.v; item.kind = 'equ'; return;
      }
      let rest = t;
      const defLabel = name => {
        const k = name.toUpperCase();
        if (k in syms) throw new Error(`"${name}" is already defined`);
        if (MN[k]) throw new Error(`"${name}" is an instruction name and can't be a label`);
        syms[k] = pc; item.label = name;
      };
      if ((m = t.match(/^([A-Za-z_]\w*)\s*:\s*(.*)$/))) { defLabel(m[1]); rest = m[2].trim(); }
      else if (!/^\s/.test(s)) {
        const w = t.match(/^([A-Za-z_]\w*)(?:\s+(.*))?$/);
        if (w && !MN[w[1].toUpperCase()]) {
          const nxt = (w[2] || '').trim();
          const first = (nxt.match(/^\.?[A-Za-z]+/) || [''])[0];
          if (!nxt || first[0] === '.' || MN[first.toUpperCase()]) { defLabel(w[1]); rest = nxt; }
        }
      }
      if (!rest) { item.kind = 'label'; item.addr = pc; return; }

      if (rest[0] === '.') {
        const dm = rest.match(/^\.(\w+)\s*(.*)$/);
        if (!dm) throw new Error(`can't understand "${rest}"`);
        const dn = dm[1].toLowerCase(), arg = dm[2];
        item.addr = pc;
        if (dn === 'org') {
          const r = evalExpr(arg, { syms, pc, pass: 1 });
          if (r.unresolved) throw new Error('the origin must use values defined earlier');
          checkAddr(r.v); pc = r.v; item.kind = 'org'; item.addr = pc; return;
        }
        if (['byte', 'db', 'text', 'ascii', 'asciiz'].includes(dn)) {
          item.kind = 'data'; item.dir = 'byte'; item.zero = dn === 'asciiz'; item.args = splitArgs(arg);
          if (!item.args.length) throw new Error(`.${dn} needs at least one value`);
        } else if (dn === 'word' || dn === 'dw') {
          item.kind = 'data'; item.dir = 'word'; item.args = splitArgs(arg);
          if (!item.args.length) throw new Error(`.${dn} needs at least one value`);
        } else if (dn === 'res' || dn === 'fill' || dn === 'ds') {
          const a = splitArgs(arg);
          if (!a.length) throw new Error(`.${dn} needs a count`);
          const r = evalExpr(a[0], { syms, pc, pass: 1 });
          if (r.unresolved || r.v < 0) throw new Error('the count must use values defined earlier');
          item.kind = 'data'; item.dir = 'res'; item.count = r.v; item.args = a.slice(1);
        } else throw new Error(`unknown directive ".${dn}"`);
        const size = item.dir === 'res' ? item.count : dataSize(item);
        pc += size;
        if (pc > 0x10000) throw new Error('data runs past $FFFF');
        return;
      }

      const im = rest.match(/^([A-Za-z]{3})(?![A-Za-z0-9_])\s*(.*)$/);
      if (!im || !MN[im[1].toUpperCase()]) throw new Error(`unknown instruction "${(rest.match(/^\S+/) || [rest])[0]}"`);
      const mn = im[1].toUpperCase();
      const sel = pickMode(mn, parseOperand(im[2]), { syms, pc, pass: 1 });
      item.kind = 'instr'; item.mn = mn; item.mode = sel.mode; item.expr = sel.expr; item.addr = pc;
      pc += MODE_LEN[sel.mode];
      if (pc > 0x10000) throw new Error('program runs past $FFFF');
    } catch (e) { errors.push({ line: li + 1, msg: e.message }); item.kind = 'bad'; }
  });

  // pass 2: emit bytes
  for (const item of items) {
    try {
      if (item.kind === 'instr') {
        const bytes = [MN[item.mn][item.mode].op];
        if (MODE_LEN[item.mode] > 1) {
          const v = evalExpr(item.expr, { syms, pc: item.addr, pass: 2 }).v;
          const fmt = n => (n < 0 ? '-$' + (-n).toString(16).toUpperCase() : '$' + n.toString(16).toUpperCase());
          switch (item.mode) {
            case 'imm':
              if (v < -128 || v > 255) throw new Error(`${fmt(v)} doesn't fit in one byte`);
              bytes.push(v & 0xFF); break;
            case 'rel': {
              const off = v - (item.addr + 2);
              if (off < -128 || off > 127) throw new Error(`branch target is ${Math.abs(off)} bytes ${off > 0 ? 'ahead' : 'back'}, but branches reach only -128 to +127`);
              bytes.push(off & 0xFF); break;
            }
            case 'zp': case 'zpx': case 'zpy': case 'izx': case 'izy':
              if (v < 0 || v > 255) throw new Error(`${fmt(v)} is outside zero page ($00-$FF)`);
              bytes.push(v); break;
            default:
              if (v < 0 || v > 0xFFFF) throw new Error(`${fmt(v)} is outside $0000-$FFFF`);
              bytes.push(v & 0xFF, (v >> 8) & 0xFF);
          }
        }
        item.bytes = bytes;
      } else if (item.kind === 'data') {
        const out = [], ctx = { syms, pc: item.addr, pass: 2 };
        if (item.dir === 'res') {
          let fill = 0;
          if (item.args.length) fill = evalExpr(item.args[0], ctx).v & 0xFF;
          for (let i = 0; i < item.count; i++) out.push(fill);
        } else if (item.dir === 'word') {
          for (const a of item.args) { const v = evalExpr(a, ctx).v; if (v < -32768 || v > 0xFFFF) throw new Error(`${v} doesn't fit in a word`); out.push(v & 0xFF, (v >> 8) & 0xFF); }
        } else {
          for (const a of item.args) {
            const sm = a.match(/^"(.*)"$/s);
            if (sm) out.push(...unescapeStr(sm[1]));
            else { const v = evalExpr(a, ctx).v; if (v < -128 || v > 255) throw new Error(`${v} doesn't fit in one byte`); out.push(v & 0xFF); }
          }
          if (item.zero) out.push(0);
        }
        item.bytes = out;
      }
    } catch (e) { errors.push({ line: item.line + 1, msg: e.message }); }
  }

  errors.sort((a, b) => a.line - b.line);
  const segments = [];
  let start = null, lo = 0x10000, hi = -1, size = 0;
  for (const it of items) {
    if (!it.bytes.length) continue;
    segments.push({ addr: it.addr, bytes: it.bytes });
    if (start === null && it.kind === 'instr') start = it.addr;
    lo = Math.min(lo, it.addr); hi = Math.max(hi, it.addr + it.bytes.length - 1); size += it.bytes.length;
  }
  if (start === null) start = segments.length ? segments[0].addr : 0x0600;
  return { ok: errors.length === 0 && segments.length > 0, empty: segments.length === 0, errors, items, syms, segments, start, size, lo, hi };
}

function disasm(mem, pc) {
  const op = mem[pc], d = OPS[op];
  if (!d) return { text: '???', len: 1, bytes: [op], d: null };
  const b1 = mem[(pc + 1) & 0xFFFF], b2 = mem[(pc + 2) & 0xFFFF];
  const h2 = v => '$' + hex2(v), h4 = v => '$' + hex4(v);
  let o = '';
  switch (d.mode) {
    case 'acc': o = ' A'; break;
    case 'imm': o = ' #' + h2(b1); break;
    case 'zp': o = ' ' + h2(b1); break;
    case 'zpx': o = ' ' + h2(b1) + ',X'; break;
    case 'zpy': o = ' ' + h2(b1) + ',Y'; break;
    case 'rel': o = ' ' + h4(pc + 2 + (b1 << 24 >> 24)); break;
    case 'abs': o = ' ' + h4(b1 | b2 << 8); break;
    case 'abx': o = ' ' + h4(b1 | b2 << 8) + ',X'; break;
    case 'aby': o = ' ' + h4(b1 | b2 << 8) + ',Y'; break;
    case 'izx': o = ` (${h2(b1)},X)`; break;
    case 'izy': o = ` (${h2(b1)}),Y`; break;
    case 'ind': o = ` (${h4(b1 | b2 << 8)})`; break;
  }
  return { text: d.m + o, len: d.len, bytes: [op, b1, b2].slice(0, d.len), d };
}

/* ---------- CPU ---------- */
class CPU {
  constructor() { this.mem = new Uint8Array(65536); this.lastWrites = []; this.onWrite = null; this.reset(0x0600); }
  reset(pc) {
    this.a = this.x = this.y = 0; this.sp = 0xFF; this.pc = pc & 0xFFFF;
    this.n = this.v = this.b = this.d = this.z = this.c = 0; this.i = 1;
    this.cycles = 0; this.instr = 0; this.halted = false; this.haltReason = ''; this.lastWrites = [];
  }
  getP(forceB) { return (this.n << 7) | (this.v << 6) | 32 | ((forceB || this.b) ? 16 : 0) | (this.d << 3) | (this.i << 2) | (this.z << 1) | this.c; }
  setP(p) { this.n = p >> 7 & 1; this.v = p >> 6 & 1; this.d = p >> 3 & 1; this.i = p >> 2 & 1; this.z = p >> 1 & 1; this.c = p & 1; }
  rd(a) { a &= 0xFFFF; return a === 0xFE ? (Math.random() * 256) | 0 : this.mem[a]; }
  wr(a, v) {
    a &= 0xFFFF; v &= 0xFF;
    this.lastWrites.push([a, this.mem[a], v]);
    this.mem[a] = v;
    if (this.onWrite) this.onWrite(a, v);
  }
  push(v) { this.wr(0x100 + this.sp, v); this.sp = (this.sp - 1) & 0xFF; }
  pull() { this.sp = (this.sp + 1) & 0xFF; return this.mem[0x100 + this.sp]; }
  nz(v) { this.n = v >> 7 & 1; this.z = v === 0 ? 1 : 0; return v; }
  adc(m) {
    const a = this.a, c = this.c, sum = a + m + c;
    if (!this.d) {
      this.v = (~(a ^ m) & (a ^ sum) & 0x80) ? 1 : 0;
      this.c = sum > 0xFF ? 1 : 0;
      this.a = this.nz(sum & 0xFF);
    } else {
      let lo = (a & 0x0F) + (m & 0x0F) + c;
      if (lo > 9) lo += 6;
      let hi = (a >> 4) + (m >> 4) + (lo > 0x0F ? 1 : 0);
      this.z = (sum & 0xFF) === 0 ? 1 : 0;
      this.n = ((hi << 4) & 0x80) ? 1 : 0;
      this.v = (~(a ^ m) & (a ^ (hi << 4)) & 0x80) ? 1 : 0;
      if (hi > 9) hi += 6;
      this.c = hi > 0x0F ? 1 : 0;
      this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
    }
  }
  sbc(m) {
    const a = this.a, c = this.c, diff = a - m - (1 - c);
    this.v = ((a ^ m) & (a ^ diff) & 0x80) ? 1 : 0;
    this.c = diff >= 0 ? 1 : 0;
    const r = diff & 0xFF;
    this.nz(r);
    if (!this.d) this.a = r;
    else {
      let lo = (a & 0x0F) - (m & 0x0F) - (1 - c), hi = (a >> 4) - (m >> 4);
      if (lo < 0) { lo -= 6; hi--; }
      if (hi < 0) hi -= 6;
      this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
    }
  }
  cmp(r, m) { this.c = r >= m ? 1 : 0; this.nz((r - m) & 0xFF); }
  step() {
    if (this.halted) return null;
    const pc0 = this.pc, op = this.mem[pc0], d = OPS[op];
    this.lastWrites = [];
    if (!d) {
      this.halted = true;
      this.haltReason = `Unknown opcode $${hex2(op)} at $${hex4(pc0)}. The CPU ran into data or empty memory.`;
      return { pc: pc0, op, d: null, cyc: 0 };
    }
    const lo = this.mem[(pc0 + 1) & 0xFFFF], hi = this.mem[(pc0 + 2) & 0xFFFF];
    this.pc = (pc0 + d.len) & 0xFFFF;
    let cyc = d.cyc, ea = -1, crossed = false;
    switch (d.mode) {
      case 'imm': ea = (pc0 + 1) & 0xFFFF; break;
      case 'zp': ea = lo; break;
      case 'zpx': ea = (lo + this.x) & 0xFF; break;
      case 'zpy': ea = (lo + this.y) & 0xFF; break;
      case 'abs': ea = lo | hi << 8; break;
      case 'abx': { const b = lo | hi << 8; ea = (b + this.x) & 0xFFFF; crossed = (b & 0xFF00) !== (ea & 0xFF00); break; }
      case 'aby': { const b = lo | hi << 8; ea = (b + this.y) & 0xFFFF; crossed = (b & 0xFF00) !== (ea & 0xFF00); break; }
      case 'izx': { const p = (lo + this.x) & 0xFF; ea = this.mem[p] | this.mem[(p + 1) & 0xFF] << 8; break; }
      case 'izy': { const b = this.mem[lo] | this.mem[(lo + 1) & 0xFF] << 8; ea = (b + this.y) & 0xFFFF; crossed = (b & 0xFF00) !== (ea & 0xFF00); break; }
      case 'ind': { const p = lo | hi << 8; ea = this.mem[p] | this.mem[(p & 0xFF00) | ((p + 1) & 0xFF)] << 8; break; }
    }
    if (crossed && d.pen) cyc++;
    const m = d.m;
    const branch = cond => {
      if (cond) {
        const target = (this.pc + (lo << 24 >> 24)) & 0xFFFF;
        cyc++; if ((target & 0xFF00) !== (this.pc & 0xFF00)) cyc++;
        this.pc = target;
      }
    };
    switch (m) {
      case 'LDA': this.a = this.nz(this.rd(ea)); break;
      case 'LDX': this.x = this.nz(this.rd(ea)); break;
      case 'LDY': this.y = this.nz(this.rd(ea)); break;
      case 'STA': this.wr(ea, this.a); break;
      case 'STX': this.wr(ea, this.x); break;
      case 'STY': this.wr(ea, this.y); break;
      case 'TAX': this.x = this.nz(this.a); break;
      case 'TAY': this.y = this.nz(this.a); break;
      case 'TXA': this.a = this.nz(this.x); break;
      case 'TYA': this.a = this.nz(this.y); break;
      case 'TSX': this.x = this.nz(this.sp); break;
      case 'TXS': this.sp = this.x; break;
      case 'PHA': this.push(this.a); break;
      case 'PHP': this.push(this.getP(1)); break;
      case 'PLA': this.a = this.nz(this.pull()); break;
      case 'PLP': this.setP(this.pull()); break;
      case 'AND': this.a = this.nz(this.a & this.rd(ea)); break;
      case 'ORA': this.a = this.nz(this.a | this.rd(ea)); break;
      case 'EOR': this.a = this.nz(this.a ^ this.rd(ea)); break;
      case 'ADC': this.adc(this.rd(ea)); break;
      case 'SBC': this.sbc(this.rd(ea)); break;
      case 'CMP': this.cmp(this.a, this.rd(ea)); break;
      case 'CPX': this.cmp(this.x, this.rd(ea)); break;
      case 'CPY': this.cmp(this.y, this.rd(ea)); break;
      case 'BIT': { const v = this.rd(ea); this.z = (this.a & v) === 0 ? 1 : 0; this.n = v >> 7 & 1; this.v = v >> 6 & 1; break; }
      case 'INC': this.wr(ea, this.nz((this.rd(ea) + 1) & 0xFF)); break;
      case 'DEC': this.wr(ea, this.nz((this.rd(ea) - 1) & 0xFF)); break;
      case 'INX': this.x = this.nz((this.x + 1) & 0xFF); break;
      case 'INY': this.y = this.nz((this.y + 1) & 0xFF); break;
      case 'DEX': this.x = this.nz((this.x - 1) & 0xFF); break;
      case 'DEY': this.y = this.nz((this.y - 1) & 0xFF); break;
      case 'ASL': case 'LSR': case 'ROL': case 'ROR': {
        const v = d.mode === 'acc' ? this.a : this.rd(ea);
        let r, c;
        if (m === 'ASL') { c = v >> 7 & 1; r = (v << 1) & 0xFF; }
        else if (m === 'LSR') { c = v & 1; r = v >> 1; }
        else if (m === 'ROL') { c = v >> 7 & 1; r = ((v << 1) | this.c) & 0xFF; }
        else { c = v & 1; r = (v >> 1) | (this.c << 7); }
        this.c = c; this.nz(r);
        if (d.mode === 'acc') this.a = r; else this.wr(ea, r);
        break;
      }
      case 'JMP': this.pc = ea; break;
      case 'JSR': { const ret = (pc0 + 2) & 0xFFFF; this.push(ret >> 8); this.push(ret & 0xFF); this.pc = ea; break; }
      case 'RTS': { const l = this.pull(), h = this.pull(); this.pc = ((h << 8 | l) + 1) & 0xFFFF; break; }
      case 'RTI': { this.setP(this.pull()); const l = this.pull(), h = this.pull(); this.pc = h << 8 | l; break; }
      case 'BRK': this.halted = true; this.b = 1; this.haltReason = `BRK at $${hex4(pc0)}. The program has stopped.`; this.pc = pc0; break;
      case 'BCC': branch(!this.c); break;
      case 'BCS': branch(this.c); break;
      case 'BEQ': branch(this.z); break;
      case 'BNE': branch(!this.z); break;
      case 'BMI': branch(this.n); break;
      case 'BPL': branch(!this.n); break;
      case 'BVC': branch(!this.v); break;
      case 'BVS': branch(this.v); break;
      case 'CLC': this.c = 0; break;
      case 'SEC': this.c = 1; break;
      case 'CLD': this.d = 0; break;
      case 'SED': this.d = 1; break;
      case 'CLI': this.i = 0; break;
      case 'SEI': this.i = 1; break;
      case 'CLV': this.v = 0; break;
      case 'NOP': break;
    }
    this.cycles += cyc; this.instr++;
    return { pc: pc0, op, d, ea, cyc };
  }
}
if (typeof module !== 'undefined') module.exports = { assemble, CPU, disasm, OPS, MN, SPEC, INFO, GROUPS, hex2, hex4 };
