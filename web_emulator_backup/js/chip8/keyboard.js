/* ==========================================================================
   AURA ARCADE - CHIP-8 KEYBOARD HANDLER
   ========================================================================== */

// Default Key Mapping: Chip-8 Hex Key -> Modern Keyboard Key Code
const DEFAULT_KEY_MAP = {
  '1': 'Key1', '2': 'Key2', '3': 'Key3', 'C': 'Key4',
  '4': 'KeyQ', '5': 'KeyW', '6': 'KeyE', 'D': 'KeyR',
  '7': 'KeyA', '8': 'KeyS', '9': 'KeyD', 'E': 'KeyF',
  'A': 'KeyZ', '0': 'KeyX', 'B': 'KeyC', 'F': 'KeyV'
};

export class Keyboard {
  constructor() {
    this.keyStates = new Array(16).fill(false);
    
    // Maps Modern PC Keyboard code (e.g. "KeyQ") to Chip-8 Hex Key (0 to 15)
    this.pcToChip8Map = {};
    
    // Maps Chip-8 Hex Key (0 to 15) to Modern PC Keyboard code
    this.chip8ToPcMap = {};
    
    // Callback function when a key is pressed (used for FX0A wait instruction)
    this.onKeyPressCallback = null;
    
    this.resetDefaults();
    this.setupListeners();
  }

  /**
   * Resets mappings back to default layouts.
   */
  resetDefaults() {
    this.pcToChip8Map = {};
    this.chip8ToPcMap = {};
    
    for (const [chip8Hex, pcKey] of Object.entries(DEFAULT_KEY_MAP)) {
      const chip8Val = parseInt(chip8Hex, 16);
      this.pcToChip8Map[pcKey] = chip8Val;
      this.chip8ToPcMap[chip8Val] = pcKey;
    }
  }

  /**
   * Updates key mapping for a specific Chip-8 Hex Key.
   */
  bindKey(chip8Val, newPcKey) {
    // Delete old binding from PC map if it existed
    const oldPcKey = this.chip8ToPcMap[chip8Val];
    if (oldPcKey) {
      delete this.pcToChip8Map[oldPcKey];
    }
    
    // Remove new PC key from any other binding it had to avoid duplicates
    const oldChip8Val = this.pcToChip8Map[newPcKey];
    if (oldChip8Val !== undefined) {
      this.chip8ToPcMap[oldChip8Val] = null;
    }
    
    // Set new mapping
    this.pcToChip8Map[newPcKey] = chip8Val;
    this.chip8ToPcMap[chip8Val] = newPcKey;
  }

  /**
   * Gets clean display name for keycode (e.g. "KeyQ" -> "Q")
   */
  getKeyDisplay(chip8Val) {
    const code = this.chip8ToPcMap[chip8Val];
    if (!code) return "NONE";
    return code.replace("Key", "").replace("Digit", "");
  }

  /**
   * Setup Event Listeners on the browser window.
   */
  setupListeners() {
    window.addEventListener('keydown', (e) => {
      const chip8Val = this.pcToChip8Map[e.code];
      if (chip8Val !== undefined && chip8Val !== null) {
        this.keyStates[chip8Val] = true;
        
        if (this.onKeyPressCallback) {
          this.onKeyPressCallback(chip8Val);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const chip8Val = this.pcToChip8Map[e.code];
      if (chip8Val !== undefined && chip8Val !== null) {
        this.keyStates[chip8Val] = false;
      }
    });
  }

  /**
   * Checks if a Chip-8 key (0 to 15) is currently pressed.
   */
  isKeyPressed(chip8Val) {
    if (chip8Val < 0 || chip8Val > 15) return false;
    return this.keyStates[chip8Val];
  }

  /**
   * Registers a callback function when any valid key is pressed down.
   */
  registerOnKeyPress(callback) {
    this.onKeyPressCallback = callback;
  }

  /**
   * Forces release of all keys (called on reset or power off)
   */
  clearKeys() {
    this.keyStates.fill(false);
  }
}
