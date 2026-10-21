# 6502 Workbench

**English** · [Deutsch](README.de.md)

A 6502 assembler and CPU emulator for learning. Runs entirely in the browser, with no build step and no dependencies.

- Two-pass assembler: all 56 official instructions, 13 addressing modes, labels, constants, `.org`, `.byte`, `.word`, `.text`, `.res`
- CPU with flags, cycle counting and decimal mode (NMOS 6502)
- Step-by-step execution with explanations, breakpoints and a register view
- Hex memory view, 32x32 pixel display from `$0200`, `$FE` = random byte, `$FF` = last key pressed
- 7 example programs

## Getting started

Open `index.html` directly in a browser, or use a local server:

```
npm start
```

In IntelliJ IDEA: right-click `index.html` > *Open in > Browser*.

## Tests

Requires Node.js (no other packages):

```
npm test
```

## Structure

```
index.html        Page
css/style.css     Styles (light/dark automatically)
js/core.js        Opcode table, assembler, CPU, disassembler
js/examples.js    Example programs
js/ui.js          User interface
test/test.js      Tests for assembler and CPU
```

`BRK` stops the program instead of triggering an interrupt. Unofficial opcodes are not included.

## License

MIT, see [LICENSE](LICENSE).
