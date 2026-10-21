/* ===== Example programs ===== */
const EXAMPLES = [
  { id: 'add', name: '1. Load, add, store', speed: 2, page: 0,
    note: 'Step through and watch A change. CLC clears the carry flag first because ADC always adds the carry in. The memory panel shows zero page, so you can see $10 become $08 when STA runs.',
    src: `; Add 5 + 3 and keep the result
        LDA #$05      ; A = 5
        CLC           ; clear carry before adding
        ADC #$03      ; A = A + 3 + carry
        STA $10       ; write A to address $10
        BRK           ; stop
` },
  { id: 'count', name: '2. A counting loop', speed: 5, page: 0,
    note: 'X counts up to 10. CPX sets the Z flag when X equals 10, and BNE only branches back while Z is 0. Watch Z flip on the last pass and the cycle counter grow, one extra cycle for each branch taken.',
    src: `; Count X from 0 up to 10
        LDX #0
loop:   INX           ; X = X + 1
        CPX #10       ; compare X with 10 (sets Z when equal)
        BNE loop      ; not equal yet? go round again
        STX $00       ; save the final count
        BRK
` },
  { id: 'sum', name: '3. Sum a table', speed: 5, page: 0,
    note: 'ADC data,X reads the byte at the label plus X (absolute indexed). The total, 150 or $96, ends up at $00. Click a line number to set a breakpoint, then press Run and the CPU pauses there.',
    src: `; Add up five numbers from a table
        LDX #0        ; index into the table
        LDA #0        ; running total
sum:    CLC
        ADC data,X    ; A = A + data[X]
        INX
        CPX #5
        BNE sum
        STA $00       ; total = 150 ($96)
        BRK
data:   .byte 10, 20, 30, 40, 50
` },
  { id: 'sub', name: '4. Subroutines and the stack', speed: 2, page: 1,
    note: 'JSR pushes the return address onto the stack and jumps. RTS pulls it back off. The memory view shows stack page $01: the address appears at $01FF and $01FE as JSR runs, and SP drops by two. The answer, 12, lands in $00.',
    src: `; Call a subroutine twice
        LDA #$03
        JSR double    ; push return address, jump
        JSR double
        STA $00       ; 3 x 2 x 2 = 12
        BRK
double: ASL A         ; shift left = multiply by 2
        RTS           ; pull return address, go back
` },
  { id: 'stripes', name: '5. Color stripes', speed: 100, page: 2,
    note: 'Each byte written to $0200 and up is one pixel. Its low four bits pick one of 16 colors, shown under the display. This loop stores X, counting 0 to 255, into the first 256 pixels.',
    src: `; Fill the top of the display with the palette
        LDX #0
loop:   TXA           ; copy X into A
        STA $0200,X   ; pixel X gets color (X AND $0F)
        INX
        BNE loop      ; X wraps from 255 to 0, so Z ends the loop
        BRK
` },
  { id: 'confetti', name: '6. Random confetti', speed: 1000, page: 0,
    note: 'Reading $FE gives a new random byte every time. The program builds a pointer to a random pixel in $10 and $11, then STA ($10),Y writes a random color through it. This is indirect indexed addressing.',
    src: `; Random pixels forever
loop:   LDA $FE        ; random low byte of the address
        STA $10
        LDA $FE        ; random number for the high byte
        AND #$03       ; keep 0 to 3
        CLC
        ADC #$02       ; 2 to 5: the four display pages
        STA $11
        LDA $FE        ; random color
        LDY #0
        STA ($10),Y    ; plot it
        JMP loop
` },
  { id: 'move', name: '7. Move a pixel', speed: 1000, page: 2,
    note: 'Press Run, then use A and D on the keyboard or the on-screen keys. The program polls $FF, the last key pressed, and moves a white pixel left or right along the first row.',
    src: `; Move a pixel with A (left) and D (right)
        LDX #0
draw:   LDA #1
        STA $0200,X   ; draw the pixel
        LDA #0
        STA $FF       ; forget the last key
wait:   LDA $FF
        CMP #$64      ; 'd'
        BEQ right
        CMP #$61      ; 'a'
        BEQ left
        JMP wait
right:  LDA #0
        STA $0200,X   ; erase the old pixel
        INX
        JMP draw
left:   LDA #0
        STA $0200,X
        DEX
        JMP draw
` },
  { id: 'blank', name: 'Blank program', speed: 5, page: 6,
    note: 'Write your own. Programs start at $0600 unless you use .org. Open the reference at the bottom for syntax, addressing modes and every instruction.',
    src: `; Your program
        .org $0600

        LDA #$00

        BRK
` }
];
if (typeof module !== 'undefined') module.exports = { EXAMPLES };
