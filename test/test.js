const fs = require('fs');
const dir = __dirname;
const code = fs.readFileSync(dir + '/../js/core.js', 'utf8') + '\n' + fs.readFileSync(dir + '/../js/examples.js', 'utf8') +
  '\nreturn {assemble,CPU,disasm,OPS,MN,INFO,GROUPS,EXAMPLES,hex2,hex4};';
const T = new Function('module', code)(undefined);
const { assemble, CPU, disasm, OPS, MN, INFO, GROUPS, EXAMPLES } = T;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function load(src) {
  const r = assemble(src);
  if (!r.ok) { console.log(JSON.stringify(r.errors)); return { r }; }
  const cpu = new CPU();
  for (const s of r.segments) s.bytes.forEach((b, i) => cpu.mem[s.addr + i] = b);
  cpu.reset(r.start);
  return { r, cpu };
}
function run(cpu, max = 100000) { let n = 0; while (!cpu.halted && n++ < max) cpu.step(); return n; }

// table sanity
const cnt = Object.keys(MN).length;
ok(cnt === 56, `56 mnemonics (${cnt})`);
let opcodes = OPS.filter(Boolean).length;
ok(opcodes === 151, `151 official opcodes (${opcodes})`);
ok(Object.keys(INFO).length === 56, 'INFO covers 56');
ok(GROUPS.flatMap(g => g[1]).every(m => MN[m]) && GROUPS.flatMap(g => g[1]).length === 56, 'GROUPS cover all');

// examples
for (const ex of EXAMPLES) {
  const { r, cpu } = load(ex.src);
  ok(r.ok, `assembles: ${ex.name}`);
  if (!r.ok) continue;
  if (ex.id === 'add') { run(cpu); ok(cpu.mem[0x10] === 8 && cpu.halted, 'add: $10 = 8'); }
  if (ex.id === 'count') { run(cpu); ok(cpu.mem[0] === 10, 'count: $00 = 10'); }
  if (ex.id === 'sum') { run(cpu); ok(cpu.mem[0] === 150, 'sum: $00 = 150'); }
  if (ex.id === 'sub') {
    // step through the first JSR
    cpu.step(); cpu.step();
    ok(cpu.sp === 0xFD && cpu.mem[0x1FF] === 0x06 && cpu.mem[0x1FE] === 0x04, `sub: stack after JSR (sp=${cpu.sp.toString(16)}, ${cpu.mem[0x1FF].toString(16)} ${cpu.mem[0x1FE].toString(16)})`);
    run(cpu); ok(cpu.mem[0] === 12 && cpu.sp === 0xFF, 'sub: $00 = 12, SP back to FF');
  }
  if (ex.id === 'stripes') { run(cpu); let g = true; for (let i = 0; i < 256; i++) if (cpu.mem[0x200 + i] !== i) g = false; ok(g, 'stripes: 256 pixels'); }
  if (ex.id === 'confetti') {
    run(cpu, 20000); let lit = 0; for (let i = 0x200; i < 0x600; i++) if (cpu.mem[i]) lit++;
    ok(lit > 300 && !cpu.halted, `confetti: ${lit} pixels lit`);
  }
  if (ex.id === 'move') {
    for (let i = 0; i < 50; i++) cpu.step();
    ok(cpu.mem[0x200] === 1, 'move: pixel drawn');
    cpu.mem[0xFF] = 0x64; for (let i = 0; i < 50; i++) cpu.step();
    ok(cpu.mem[0x200] === 0 && cpu.mem[0x201] === 1, 'move: moved right');
    cpu.mem[0xFF] = 0x61; for (let i = 0; i < 50; i++) cpu.step();
    ok(cpu.mem[0x200] === 1 && cpu.mem[0x201] === 0, 'move: moved left');
  }
}

// known encodings
let { r } = load('LDA #$05\nSTA $0200,X\nLDA ($10),Y\nJMP ($1234)\nASL A\nASL\nBNE $0600\nLDX $10,Y\n');
ok(r.ok, 'encoding source assembles');
const b = r.segments.map(s => s.bytes.map(x => x.toString(16).padStart(2, '0')).join(' '));
ok(b[0] === 'a9 05', 'LDA #$05 = A9 05');
ok(b[1] === '9d 00 02', 'STA $0200,X = 9D 00 02');
ok(b[2] === 'b1 10', 'LDA ($10),Y = B1 10');
ok(b[3] === '6c 34 12', 'JMP ($1234) = 6C 34 12');
ok(b[4] === '0a' && b[5] === '0a', 'ASL A / ASL = 0A');
ok(b[6] === 'd0 ' + ((0x0600 - (0x060C + 2)) & 0xFF).toString(16), `BNE back = ${b[6]}`);
ok(b[7] === 'b6 10', 'LDX $10,Y = B6 10');

// errors
const e1 = assemble('LDAA #1\nLDA\nSTA #5\nBNE nowhere\nLDA #300\n');
ok(!e1.ok && e1.errors.length === 5, `5 errors reported (${e1.errors.length})`);
console.log(e1.errors.map(e => `  line ${e.line}: ${e.msg}`).join('\n'));
const e2 = assemble('        .org $0600\n        BNE far\n        .res 200\nfar:    NOP\n');
ok(!e2.ok && /branch target/.test(e2.errors[0].msg), 'branch too far detected');

// labels, constants, expressions
({ r } = load('SCREEN = $0200\nCOLOR .equ 5\n        LDA #COLOR+1\n        STA SCREEN+1\n        LDX #<msg\n        LDY #>msg\n        BRK\nmsg:    .text "Hi", 0\n        .word msg, $BEEF\n'));
ok(r.ok, 'expressions assemble');
const flat = r.segments.flatMap(s => s.bytes);
ok(flat[0] === 0xA9 && flat[1] === 6, 'LDA #COLOR+1');
ok(flat[2] === 0x8D && flat[3] === 1 && flat[4] === 2, 'STA SCREEN+1 abs');
ok(flat[6] === 0x0A && flat[8] === 0x06, 'low/high bytes of msg');
ok(flat.slice(-7).join() === [0x48, 0x69, 0, 0x0A, 0x06, 0xEF, 0xBE].join(), 'text and words: ' + flat.slice(-7).join());

// instruction behaviour
function prog(src, steps) { const { cpu } = load(src); for (let i = 0; i < steps; i++) cpu.step(); return cpu; }
let c = prog('SED\nCLC\nLDA #$15\nADC #$27\nBRK', 4);
ok(c.a === 0x42 && !c.c, 'decimal ADC 15+27=42');
c = prog('SED\nCLC\nLDA #$58\nADC #$46\nBRK', 4);
ok(c.a === 0x04 && c.c === 1, 'decimal ADC 58+46=104 carry');
c = prog('SED\nSEC\nLDA #$46\nSBC #$12\nBRK', 4);
ok(c.a === 0x34 && c.c === 1, 'decimal SBC 46-12=34');
c = prog('CLC\nLDA #$7F\nADC #$01', 3);
ok(c.a === 0x80 && c.v === 1 && c.n === 1 && c.c === 0, 'ADC overflow 7F+1');
c = prog('SEC\nLDA #$50\nSBC #$B0', 3);
ok(c.a === 0xA0 && c.v === 1 && c.c === 0, 'SBC overflow 50-B0');
c = prog('LDA #$10\nCMP #$10', 2);
ok(c.z === 1 && c.c === 1 && c.n === 0, 'CMP equal');
c = prog('LDA #$10\nCMP #$20', 2);
ok(c.z === 0 && c.c === 0 && c.n === 1, 'CMP less');
c = prog('LDA #$81\nSEC\nROL A', 3);
ok(c.a === 0x03 && c.c === 1, 'ROL A');
c = prog('LDA #$01\nSEC\nROR A', 3);
ok(c.a === 0x80 && c.c === 1 && c.n === 1, 'ROR A');
c = prog('LDA #$FF\nPHA\nPHP\nLDA #0\nPLP\nPLA', 6);
ok(c.a === 0xFF && c.sp === 0xFF, 'PHA/PHP/PLP/PLA');
c = prog('LDX #$05\nTXS\nTSX', 3);
ok(c.sp === 5 && c.x === 5, 'TXS/TSX');
c = prog('LDA #$00\nSTA $30\nLDA #$07\nSTA $31\nJMP ($0030)\n.org $0700\nLDX #$99', 6);
ok(c.pc === 0x0702 && c.x === 0x99, 'JMP indirect ' + c.pc.toString(16));
c = prog('INC $10\nINC $10\nDEC $10\nLDA $10', 4);
ok(c.a === 1, 'INC/DEC memory');
c = prog('LDA #$0F\nSTA $20\nLDA #$C0\nBIT $20', 4);
ok(c.z === 1 && c.n === 0, 'BIT');
c = prog('LDX #$FF\nLDA #$42\nSTA $0200,X', 3);
ok(c.mem[0x2FF] === 0x42, 'STA abs,X');
c = prog('LDA #$12\nSTA $FF\nLDX #$01\nLDA #$34\nSTA $30\nLDA #$02\nSTA $31\nLDA #$99\nSTA $0234\nLDA ($2F,X)', 10);
ok(c.a === 0x99, 'indexed indirect (zp,X)');
// cycles
c = prog('LDA #$01', 1); ok(c.cycles === 2, 'LDA imm = 2 cycles');
c = prog('LDX #$FF\nLDA $0201,X', 2); ok(c.cycles === 2 + 5, 'LDA abs,X page cross = 5');
c = prog('LDX #$00\nBEQ skip\nNOP\nskip: NOP', 2); ok(c.cycles === 2 + 3, 'branch taken = 3');
c = prog('JSR sub\nBRK\nsub: RTS', 2); ok(c.cycles === 12, 'JSR + RTS = 12');
// BRK halts
c = prog('BRK', 1); ok(c.halted && c.pc === 0x0600, 'BRK halts at BRK');
// unknown opcode halts
c = prog('.byte $02', 1); ok(c.halted && /Unknown opcode/.test(c.haltReason), 'illegal opcode halts');
// disasm
const d = disasm(Uint8Array.from([0xB1, 0x10, 0]), 0); ok(d.text === 'LDA ($10),Y' && d.len === 2, 'disasm ' + d.text);
const d2 = disasm(Uint8Array.from([0xD0, 0xFE, 0]), 0); ok(d2.text === 'BNE $0000', 'disasm rel ' + d2.text);
// column-0 label without colon
({ r } = load('start\n        LDA #1\nnext    BNE start\n'));
ok(r.ok && r.syms['START'] === 0x600 && r.syms['NEXT'] === 0x602, 'labels without colon');
// semicolon in char literal
({ r } = load("        LDA #';'\n"));
ok(r.ok && r.segments[0].bytes[1] === 0x3B, 'semicolon char literal');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
