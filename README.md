# 6502 Workbench

Ein 6502-Assembler und CPU-Emulator zum Lernen. Läuft komplett im Browser, ohne Build-Schritt und ohne Abhängigkeiten.

- Zwei-Pass-Assembler: alle 56 offiziellen Befehle, 13 Adressierungsarten, Labels, Konstanten, `.org`, `.byte`, `.word`, `.text`, `.res`
- CPU mit Flags, Zykluszählung und Dezimalmodus (NMOS 6502)
- Schrittweise Ausführung mit Erklärung, Breakpoints, Registeranzeige
- Speicheransicht (Hex), 32x32-Pixeldisplay ab `$0200`, `$FE` = Zufallsbyte, `$FF` = letzte Taste
- 7 Beispielprogramme

## Starten

`index.html` direkt im Browser öffnen, oder mit einem lokalen Server:

```
npm start
```

In IntelliJ IDEA: Rechtsklick auf `index.html` > *Open in > Browser*.

## Tests

Benötigt Node.js (keine weiteren Pakete):

```
npm test
```

## Struktur

```
index.html        Seite
css/style.css     Styles (hell/dunkel automatisch)
js/core.js        Opcode-Tabelle, Assembler, CPU, Disassembler
js/examples.js    Beispielprogramme
js/ui.js          Oberfläche
test/test.js      Tests für Assembler und CPU
```

`BRK` stoppt das Programm, statt einen Interrupt auszulösen. Inoffizielle Opcodes sind nicht enthalten.
