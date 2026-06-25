/* ==========================================================================
   AURA ARCADE - CHIP-8 CPU INTERPRETER
   ========================================================================== */

const FONT_SET = [
  0xF0, 0x90, 0x90, 0x90, 0xF0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xF0, 0x10, 0xF0, 0x80, 0xF0, // 2
  0xF0, 0x10, 0xF0, 0x10, 0xF0, // 3
  0x90, 0x90, 0xF0, 0x10, 0x10, // 4
  0xF0, 0x80, 0xF0, 0x10, 0xF0, // 5
  0xF0, 0x80, 0xF0, 0x90, 0xF0, // 6
  0xF0, 0x10, 0x20, 0x40, 0x40, // 7
  0xF0, 0x90, 0xF0, 0x90, 0xF0, // 8
  0xF0, 0x90, 0xF0, 0x10, 0xF0, // 9
  0xF0, 0x90, 0xF0, 0x90, 0x90, // A
  0xE0, 0x90, 0xE0, 0x90, 0xE0, // B
  0xF0, 0x80, 0x80, 0x80, 0xF0, // C
  0xE0, 0x90, 0x90, 0x90, 0xE0, // D
  0xF0, 0x80, 0xF0, 0x80, 0xF0, // E
  0xF0, 0x80, 0xF0, 0x80, 0x80  // F
];

export class CPU {
  constructor(keyboard) {
    this.keyboard = keyboard;
    
    // Core Hardware
    this.memory = new Uint8Array(4096);
    this.v = new Uint8Array(16); // V0 to VF registers
    this.i = 0;                  // Index register
    this.pc = 0x200;             // Program counter
    this.stack = new Uint16Array(16);
    this.sp = 0;                 // Stack pointer
    
    // Timers
    this.dt = 0; // Delay timer
    this.st = 0; // Sound timer
    
    // Display Buffer (64x32 monochrome)
    this.display = new Uint8Array(64 * 32);
    
    // State Flags
    this.drawFlag = false;
    this.soundFlag = false;
    this.isPaused = false;
    this.isPowered = false;
    
    // Wait for key press state (FX0A)
    this.waitingForKey = false;
    this.keyTargetRegister = null;

    // Track recently modified registers for visual debugger highlight
    this.modifiedRegs = new Set();
    
    // Store loaded ROM data to allow easy resets
    this.loadedRom = null;
    
    this.loadFonts();
  }

  /**
   * Resets the entire CPU memory and state.
   */
  reset() {
    this.memory.fill(0);
    this.v.fill(0);
    this.i = 0;
    this.pc = 0x200;
    this.stack.fill(0);
    this.sp = 0;
    this.dt = 0;
    this.st = 0;
    this.display.fill(0);
    this.drawFlag = true;
    this.soundFlag = false;
    this.waitingForKey = false;
    this.keyTargetRegister = null;
    this.modifiedRegs.clear();
    
    this.loadFonts();
    
    // Reload ROM if we have one
    if (this.loadedRom) {
      for (let i = 0; i < this.loadedRom.length; i++) {
        this.memory[0x200 + i] = this.loadedRom[i];
      }
    }
  }

  /**
   * Loads the built-in font set into memory.
   * Font set is stored at 0x50 to 0x9F.
   */
  loadFonts() {
    for (let i = 0; i < FONT_SET.length; i++) {
      this.memory[0x50 + i] = FONT_SET[i];
    }
  }

  /**
   * Loads a new ROM into memory and resets the execution state.
   */
  loadROM(romData) {
    this.loadedRom = romData;
    this.isPowered = true;
    this.reset();
  }

  /**
   * Decrements Delay and Sound timers. Should be called at 60Hz.
   */
  updateTimers() {
    if (!this.isPowered || this.isPaused) return;

    if (this.dt > 0) {
      this.dt--;
    }
    
    if (this.st > 0) {
      this.st--;
      this.soundFlag = true;
    } else {
      this.soundFlag = false;
    }
  }

  /**
   * Handles keyboard key presses.
   * Used for FX0A wait key release.
   */
  pressKey(keyIndex) {
    if (this.waitingForKey) {
      this.v[this.keyTargetRegister] = keyIndex;
      this.modifiedRegs.add(this.keyTargetRegister);
      this.waitingForKey = false;
      this.keyTargetRegister = null;
    }
  }

  /**
   * Run a single instruction cycle.
   */
  cycle() {
    if (!this.isPowered || this.isPaused || this.waitingForKey) return;
    
    this.modifiedRegs.clear();

    // Fetch Opcode: 16-bit big-endian value
    if (this.pc >= 4095) {
      console.warn("PC out of memory bounds, looping to 0x200");
      this.pc = 0x200;
      return;
    }
    
    const opcode = (this.memory[this.pc] << 8) | this.memory[this.pc + 1];
    
    // Execute instruction
    this.executeOpcode(opcode);
  }

  /**
   * Decoder and Executor for all 35 instructions
   */
  executeOpcode(opcode) {
    // Increment PC before executing so jumps/skips can modify it relative to next PC
    this.pc += 2;

    const nnn = opcode & 0x0FFF;
    const nn = opcode & 0x00FF;
    const n = opcode & 0x000F;
    const x = (opcode & 0x0F00) >> 8;
    const y = (opcode & 0x00F0) >> 4;

    const nibble1 = (opcode & 0xF000) >> 12;

    switch (nibble1) {
      case 0x0:
        switch (opcode) {
          case 0x00E0: // 00E0 - CLS (Clear Screen)
            this.display.fill(0);
            this.drawFlag = true;
            break;
            
          case 0x00EE: // 00EE - RET (Return from Subroutine)
            if (this.sp <= 0) {
              console.error("Stack Underflow!");
              this.isPaused = true;
            } else {
              this.sp--;
              this.pc = this.stack[this.sp];
            }
            break;
            
          default:
            // 0NNN is ignored on modern systems
            break;
        }
        break;

      case 0x1: // 1NNN - JP addr
        this.pc = nnn;
        break;

      case 0x2: // 2NNN - CALL addr
        if (this.sp >= 16) {
          console.error("Stack Overflow!");
          this.isPaused = true;
        } else {
          this.stack[this.sp] = this.pc;
          this.sp++;
          this.pc = nnn;
        }
        break;

      case 0x3: // 3XNN - SE Vx, byte (Skip if equal)
        if (this.v[x] === nn) {
          this.pc += 2;
        }
        break;

      case 0x4: // 4XNN - SNE Vx, byte (Skip if not equal)
        if (this.v[x] !== nn) {
          this.pc += 2;
        }
        break;

      case 0x5: // 5XY0 - SE Vx, Vy (Skip if registers equal)
        if (this.v[x] === this.v[y]) {
          this.pc += 2;
        }
        break;

      case 0x6: // 6XNN - LD Vx, byte (Load Vx with NN)
        this.v[x] = nn;
        this.modifiedRegs.add(x);
        break;

      case 0x7: // 7XNN - ADD Vx, byte (Add NN to Vx, no carry)
        this.v[x] = (this.v[x] + nn) & 0xFF;
        this.modifiedRegs.add(x);
        break;

      case 0x8:
        switch (n) {
          case 0x0: // 8XY0 - LD Vx, Vy
            this.v[x] = this.v[y];
            this.modifiedRegs.add(x);
            break;
            
          case 0x1: // 8XY1 - OR Vx, Vy
            this.v[x] |= this.v[y];
            this.modifiedRegs.add(x);
            break;
            
          case 0x2: // 8XY2 - AND Vx, Vy
            this.v[x] &= this.v[y];
            this.modifiedRegs.add(x);
            break;
            
          case 0x3: // 8XY3 - XOR Vx, Vy
            this.v[x] ^= this.v[y];
            this.modifiedRegs.add(x);
            break;
            
          case 0x4: // 8XY4 - ADD Vx, Vy (with carry)
            const sum = this.v[x] + this.v[y];
            this.v[x] = sum & 0xFF;
            this.v[0xF] = sum > 255 ? 1 : 0;
            this.modifiedRegs.add(x);
            this.modifiedRegs.add(0xF);
            break;
            
          case 0x5: // 8XY5 - SUB Vx, Vy (Vx = Vx - Vy, VF = NOT borrow)
            const diff = this.v[x] - this.v[y];
            this.v[0xF] = this.v[x] >= this.v[y] ? 1 : 0;
            this.v[x] = diff & 0xFF;
            this.modifiedRegs.add(x);
            this.modifiedRegs.add(0xF);
            break;
            
          case 0x6: // 8XY6 - SHR Vx (Shift right, VF = LSB of Vx before shift)
            this.v[0xF] = this.v[x] & 0x1;
            this.v[x] = this.v[x] >> 1;
            this.modifiedRegs.add(x);
            this.modifiedRegs.add(0xF);
            break;
            
          case 0x7: // 8XY7 - SUBN Vx, Vy (Vx = Vy - Vx, VF = NOT borrow)
            const diffSubn = this.v[y] - this.v[x];
            this.v[0xF] = this.v[y] >= this.v[x] ? 1 : 0;
            this.v[x] = diffSubn & 0xFF;
            this.modifiedRegs.add(x);
            this.modifiedRegs.add(0xF);
            break;
            
          case 0xE: // 8XYE - SHL Vx (Shift left, VF = MSB of Vx before shift)
            this.v[0xF] = (this.v[x] & 0x80) >> 7;
            this.v[x] = (this.v[x] << 1) & 0xFF;
            this.modifiedRegs.add(x);
            this.modifiedRegs.add(0xF);
            break;
            
          default:
            console.warn(`Unknown 0x8XXX opcode: 0x${opcode.toString(16).toUpperCase()}`);
            break;
        }
        break;

      case 0x9: // 9XY0 - SNE Vx, Vy (Skip if registers not equal)
        if (this.v[x] !== this.v[y]) {
          this.pc += 2;
        }
        break;

      case 0xA: // ANNN - LD I, addr
        this.i = nnn;
        break;

      case 0xB: // BNNN - JP V0, addr
        this.pc = nnn + this.v[0];
        break;

      case 0xC: // CXNN - RND Vx, byte
        const rand = Math.floor(Math.random() * 256);
        this.v[x] = rand & nn;
        this.modifiedRegs.add(x);
        break;

      case 0xD: // DXYN - DRW Vx, Vy, nibble (Draw sprite)
        const xPos = this.v[x] % 64;
        const yPos = this.v[y] % 32;
        this.v[0xF] = 0;
        this.modifiedRegs.add(0xF);
        
        for (let row = 0; row < n; row++) {
          const spriteByte = this.memory[this.i + row];
          const currY = yPos + row;
          
          // Clip sprite vertically if it goes off bottom edge (some ROMs expect wrap, standard is clip/stop drawing)
          if (currY >= 32) break;
          
          for (let col = 0; col < 8; col++) {
            const currX = xPos + col;
            
            // Clip sprite horizontally
            if (currX >= 64) break;
            
            // Get pixel state from sprite (MSB first)
            const spritePixel = (spriteByte >> (7 - col)) & 1;
            
            if (spritePixel === 1) {
              const displayIndex = currX + currY * 64;
              
              // If screen pixel is already 1, we have a collision
              if (this.display[displayIndex] === 1) {
                this.v[0xF] = 1;
                this.modifiedRegs.add(0xF);
              }
              
              // XOR the pixel onto screen
              this.display[displayIndex] ^= 1;
            }
          }
        }
        this.drawFlag = true;
        break;

      case 0xE:
        switch (nn) {
          case 0x9E: // EX9E - SKP Vx (Skip if key pressed)
            if (this.keyboard.isKeyPressed(this.v[x])) {
              this.pc += 2;
            }
            break;
            
          case 0xA1: // EXA1 - SKNP Vx (Skip if key NOT pressed)
            if (!this.keyboard.isKeyPressed(this.v[x])) {
              this.pc += 2;
            }
            break;
            
          default:
            console.warn(`Unknown 0xEXXX opcode: 0x${opcode.toString(16).toUpperCase()}`);
            break;
        }
        break;

      case 0xF:
        switch (nn) {
          case 0x07: // FX07 - LD Vx, DT
            this.v[x] = this.dt;
            this.modifiedRegs.add(x);
            break;
            
          case 0x0A: // FX0A - LD Vx, K (Wait for key press)
            this.waitingForKey = true;
            this.keyTargetRegister = x;
            break;
            
          case 0x15: // FX15 - LD DT, Vx
            this.dt = this.v[x];
            break;
            
          case 0x18: // FX18 - LD ST, Vx
            this.st = this.v[x];
            break;
            
          case 0x1E: // FX1E - ADD I, Vx
            this.i = (this.i + this.v[x]) & 0xFFFF;
            break;
            
          case 0x29: // FX29 - LD F, Vx (Get character font location)
            // Fonts are stored at 0x50. Each font sprite is 5 bytes.
            this.i = 0x50 + (this.v[x] & 0x0F) * 5;
            break;
            
          case 0x33: // FX33 - LD B, Vx (Store BCD representation)
            const value = this.v[x];
            this.memory[this.i] = Math.floor(value / 100);
            this.memory[this.i + 1] = Math.floor((value / 10) % 10);
            this.memory[this.i + 2] = value % 10;
            break;
            
          case 0x55: // FX55 - LD [I], Vx (Store registers V0..Vx in memory starting at I)
            for (let reg = 0; reg <= x; reg++) {
              this.memory[this.i + reg] = this.v[reg];
            }
            break;
            
          case 0x65: // FX65 - LD Vx, [I] (Read registers V0..Vx from memory starting at I)
            for (let reg = 0; reg <= x; reg++) {
              this.v[reg] = this.memory[this.i + reg];
              this.modifiedRegs.add(reg);
            }
            break;
            
          default:
            console.warn(`Unknown 0xFXXX opcode: 0x${opcode.toString(16).toUpperCase()}`);
            break;
        }
        break;

      default:
        console.error(`Invalid opcode: 0x${opcode.toString(16).toUpperCase()}`);
        this.isPaused = true;
        break;
    }
  }

  /**
   * Helper to disassemble a 16-bit opcode at a specific memory location.
   */
  disassemble(address) {
    if (address < 0 || address >= 4095) return { raw: "----", desc: "Out of Bounds" };
    
    const opcode = (this.memory[address] << 8) | this.memory[address + 1];
    const opcodeStr = opcode.toString(16).padStart(4, '0').toUpperCase();
    
    const nnn = opcode & 0x0FFF;
    const nn = opcode & 0x00FF;
    const n = opcode & 0x000F;
    const x = (opcode & 0x0F00) >> 8;
    const y = (opcode & 0x00F0) >> 4;
    const nibble1 = (opcode & 0xF000) >> 12;

    let desc = "UNK";

    switch (nibble1) {
      case 0x0:
        if (opcode === 0x00E0) desc = "CLS";
        else if (opcode === 0x00EE) desc = "RET";
        else desc = `SYS 0x${nnn.toString(16).toUpperCase()}`;
        break;
      case 0x1: desc = `JP 0x${nnn.toString(16).toUpperCase()}`; break;
      case 0x2: desc = `CALL 0x${nnn.toString(16).toUpperCase()}`; break;
      case 0x3: desc = `SE V${x.toString(16).toUpperCase()}, ${nn}`; break;
      case 0x4: desc = `SNE V${x.toString(16).toUpperCase()}, ${nn}`; break;
      case 0x5: desc = `SE V${x.toString(16).toUpperCase()}, V${y.toString(16).toUpperCase()}`; break;
      case 0x6: desc = `LD V${x.toString(16).toUpperCase()}, ${nn}`; break;
      case 0x7: desc = `ADD V${x.toString(16).toUpperCase()}, ${nn}`; break;
      case 0x8:
        const hexX = x.toString(16).toUpperCase();
        const hexY = y.toString(16).toUpperCase();
        switch (n) {
          case 0x0: desc = `LD V${hexX}, V${hexY}`; break;
          case 0x1: desc = `OR V${hexX}, V${hexY}`; break;
          case 0x2: desc = `AND V${hexX}, V${hexY}`; break;
          case 0x3: desc = `XOR V${hexX}, V${hexY}`; break;
          case 0x4: desc = `ADD V${hexX}, V${hexY}`; break;
          case 0x5: desc = `SUB V${hexX}, V${hexY}`; break;
          case 0x6: desc = `SHR V${hexX}`; break;
          case 0x7: desc = `SUBN V${hexX}, V${hexY}`; break;
          case 0xE: desc = `SHL V${hexX}`; break;
        }
        break;
      case 0x9: desc = `SNE V${x.toString(16).toUpperCase()}, V${y.toString(16).toUpperCase()}`; break;
      case 0xA: desc = `LD I, 0x${nnn.toString(16).toUpperCase()}`; break;
      case 0xB: desc = `JP V0, 0x${nnn.toString(16).toUpperCase()}`; break;
      case 0xC: desc = `RND V${x.toString(16).toUpperCase()}, ${nn}`; break;
      case 0xD: desc = `DRW V${x.toString(16).toUpperCase()}, V${y.toString(16).toUpperCase()}, ${n}`; break;
      case 0xE:
        if (nn === 0x9E) desc = `SKP V${x.toString(16).toUpperCase()}`;
        else if (nn === 0xA1) desc = `SKNP V${x.toString(16).toUpperCase()}`;
        break;
      case 0xF:
        const regX = `V${x.toString(16).toUpperCase()}`;
        switch (nn) {
          case 0x07: desc = `LD ${regX}, DT`; break;
          case 0x0A: desc = `LD ${regX}, K`; break;
          case 0x15: desc = `LD DT, ${regX}`; break;
          case 0x18: desc = `LD ST, ${regX}`; break;
          case 0x1E: desc = `ADD I, ${regX}`; break;
          case 0x29: desc = `LD F, ${regX}`; break;
          case 0x33: desc = `LD B, ${regX}`; break;
          case 0x55: desc = `LD [I], ${regX}`; break;
          case 0x65: desc = `LD ${regX}, [I]`; break;
        }
        break;
    }
    
    return { raw: opcodeStr, desc: desc };
  }

  /**
   * Disassembles a slice of code around the current Program Counter (PC).
   * Returns list of { addr, raw, desc, isCurrent } objects.
   */
  getDisassemblyWindow() {
    const list = [];
    const windowSize = 8; // Number of instructions to show
    const currentPC = this.pc;
    
    // We disasm 2 instructions before current PC, and 6 after
    const startAddr = Math.max(0x200, currentPC - 4);
    
    for (let offset = 0; offset < windowSize; offset++) {
      const addr = startAddr + offset * 2;
      const dis = this.disassemble(addr);
      list.push({
        addr: `0x${addr.toString(16).toUpperCase()}`,
        raw: dis.raw,
        desc: dis.desc,
        isCurrent: addr === currentPC
      });
    }
    
    return list;
  }

  /**
   * Save CPU State snapshot for save states
   */
  getSaveStateSnapshot() {
    return {
      v: Array.from(this.v),
      i: this.i,
      pc: this.pc,
      stack: Array.from(this.stack),
      sp: this.sp,
      dt: this.dt,
      st: this.st,
      display: Array.from(this.display)
    };
  }

  /**
   * Load CPU State from a save state snapshot
   */
  loadSaveStateSnapshot(snap) {
    this.v.set(snap.v);
    this.i = snap.i;
    this.pc = snap.pc;
    this.stack.set(snap.stack);
    this.sp = snap.sp;
    this.dt = snap.dt;
    this.st = snap.st;
    this.display.set(snap.display);
    this.drawFlag = true;
  }
}
