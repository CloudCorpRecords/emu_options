/* ==========================================================================
   AURA ARCADE - MAIN ORCHESTRATOR
   ========================================================================== */

import { CPU } from './chip8/cpu.js';
import { Display } from './chip8/display.js';
import { Keyboard } from './chip8/keyboard.js';
import { BUILTIN_ROMS } from './chip8/roms.js';
import { 
  initAudio, 
  playClickSound, 
  playBootSound, 
  playPowerOffSound, 
  playTabSound, 
  startChip8Beep, 
  stopChip8Beep,
  setMute
} from './audio.js';
import { loadConsoleROM, unloadConsoleROM } from './console/loader.js';

// Elements
const body = document.body;
const themeSelect = document.getElementById('theme-select');
const crtToggle = document.getElementById('crt-toggle');
const soundToggle = document.getElementById('sound-toggle');
const tabButtons = document.querySelectorAll('.nav-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const fpsDisplay = document.getElementById('fps-display');
const cpuStatusIndicator = document.getElementById('cpu-status-indicator');

// Chip-8 Specific Elements
const canvas = document.getElementById('chip8-canvas');
const crtScreenWrapper = document.getElementById('crt-screen-wrapper');
const screenPowerOffOverlay = document.getElementById('screen-power-off');
const btnPower = document.getElementById('btn-power');
const btnPause = document.getElementById('btn-pause');
const btnStep = document.getElementById('btn-step');
const btnReset = document.getElementById('btn-reset');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const gameListContainer = document.getElementById('chip8-game-list');
const chip8FileInput = document.getElementById('chip8-file-input');
const footerRomName = document.getElementById('footer-rom-name');
const footerStatusText = document.getElementById('footer-status-text');

// Debugger Elements
const regsGrid = document.getElementById('regs-grid');
const disasmList = document.getElementById('disasm-list');
const ptrPc = document.getElementById('ptr-pc');
const ptrI = document.getElementById('ptr-i');
const ptrSp = document.getElementById('ptr-sp');
const ptrDt = document.getElementById('ptr-dt');
const ptrSt = document.getElementById('ptr-st');

// Console Elements
const consoleWelcome = document.getElementById('console-welcome');
const consoleDropZone = document.getElementById('console-drop-zone');
const consoleFileInput = document.getElementById('console-file-input');
const emuPlayerContainer = document.getElementById('emulator-player-container');
const emuCanvasHost = document.getElementById('emulator-canvas-host');
const btnClosePlayer = document.getElementById('btn-close-player');
const playerTitle = document.getElementById('player-title');
const emuLoadingOverlay = document.getElementById('emu-loading-overlay');

// Key Bindings Elements
const hexKeypadGrid = document.getElementById('hex-keypad-grid');
const keymapList = document.getElementById('keymap-list');
const btnResetKeys = document.getElementById('btn-reset-keys');

// State Variables
let keyboard;
let display;
let cpu;
let animationId = null;
let instructionsPerFrame = 12; // Controls emulator speed (cycles per animation frame)
let lastFrameTime = 0;
let lastTimerTime = 0;
let fpsCount = 0;
let fpsTimer = 0;

let audioInitialized = false;
let isRebindingKey = null; // Holds the active chip-8 key index being rebound

/**
 * Bootstraps the application.
 */
function init() {
  keyboard = new Keyboard();
  display = new Display(canvas);
  cpu = new CPU(keyboard);

  // Load Settings from LocalStorage
  loadSettings();
  
  // Set up UI listeners
  setupTabController();
  setupSettingsListeners();
  setupAudioInitTrigger();
  
  // Chip-8 Controls
  setupChip8Controls();
  buildChip8GameLibrary();
  setupDebuggerUI();
  
  // Console Player Controls
  setupConsolePlayer();
  
  // Key Bindings GUI
  buildKeypadEditor();
  keyboard.registerOnKeyPress((keyIndex) => {
    // If waiting for key press (FX0A), resume execution
    if (cpu.waitingForKey) {
      cpu.pressKey(keyIndex);
      playClickSound();
    }
    // Visually flash keypad button
    flashKeypadGUI(keyIndex);
  });

  // Start Animation Loop
  lastFrameTime = performance.now();
  lastTimerTime = performance.now();
  fpsTimer = performance.now();
  animationId = requestAnimationFrame(loop);

  display.clear();
}

/**
 * Load saved configurations.
 */
function loadSettings() {
  // Theme
  const savedTheme = localStorage.getItem('arcade-theme') || 'theme-synthwave';
  themeSelect.value = savedTheme;
  body.className = savedTheme;
  display.setTheme(savedTheme);
  
  // CRT scanlines
  const savedCrt = localStorage.getItem('arcade-crt');
  const isCrt = savedCrt === null ? true : savedCrt === 'true';
  crtToggle.checked = isCrt;
  if (isCrt) body.classList.add('crt-active');
  else body.classList.remove('crt-active');

  // Sounds
  const savedSound = localStorage.getItem('arcade-sound');
  const isSound = savedSound === null ? true : savedSound === 'true';
  soundToggle.checked = isSound;
  setMute(!isSound);
}

/**
 * Core emulator update and render loop (Runs at 60 FPS).
 */
function loop(timestamp) {
  animationId = requestAnimationFrame(loop);
  
  const elapsed = timestamp - lastFrameTime;
  lastFrameTime = timestamp;
  
  // FPS calculation
  fpsCount++;
  if (timestamp - fpsTimer >= 1000) {
    fpsDisplay.textContent = `${fpsCount} FPS`;
    fpsCount = 0;
    fpsTimer = timestamp;
  }

  if (cpu.isPowered && !cpu.isPaused && !cpu.waitingForKey) {
    // 1. Timers Update: standard Chip-8 timers decrement at 60Hz.
    // We check if 16.67ms (1/60th second) has elapsed.
    const timerElapsed = timestamp - lastTimerTime;
    if (timerElapsed >= 16.666) {
      cpu.updateTimers();
      lastTimerTime = timestamp - (timerElapsed % 16.666);
    }

    // 2. CPU Cycles: execute multiple instructions per animation frame for playable speeds.
    for (let i = 0; i < instructionsPerFrame; i++) {
      cpu.cycle();
    }

    // 3. Audio: play continuous sound if ST > 0
    if (cpu.soundFlag) {
      startChip8Beep();
    } else {
      stopChip8Beep();
    }

    // 4. Render display if canvas dirty
    if (cpu.drawFlag) {
      display.render(cpu.display);
      cpu.drawFlag = false;
    }

    // 5. Update Debugger Panel
    updateDebuggerValues();
  }
}

/* ==========================================================================
   UI CONTROLS & TAB EVENT HANDLERS
   ========================================================================== */

function setupTabController() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      playTabSound();
      
      // Toggle button states
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Toggle pane visibility
      tabPanes.forEach(pane => pane.classList.remove('active'));
      const activePane = document.getElementById(tabId);
      activePane.classList.add('active');
      
      // Perform actions based on active tab
      if (tabId === 'tab-console') {
        // Pause Chip-8 while playing retro console
        if (cpu.isPowered && !cpu.isPaused) {
          btnPause.click();
        }
      } else {
        // Unload retro console if leaving the tab to free resources
        if (tabId !== 'tab-console') {
          unloadConsolePlayer();
        }
      }
    });
  });
}

function setupSettingsListeners() {
  themeSelect.addEventListener('change', (e) => {
    const selectedTheme = e.target.value;
    body.className = selectedTheme;
    // Keep CRT state if active
    if (crtToggle.checked) body.classList.add('crt-active');
    
    display.setTheme(selectedTheme);
    display.render(cpu.display);
    localStorage.setItem('arcade-theme', selectedTheme);
    playClickSound();
    
    // Refresh Keypad editor to match theme colors
    buildKeypadEditor();
  });

  crtToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      body.classList.add('crt-active');
    } else {
      body.classList.remove('crt-active');
    }
    localStorage.setItem('arcade-crt', e.target.checked);
    playClickSound();
  });

  soundToggle.addEventListener('change', (e) => {
    setMute(!e.target.checked);
    localStorage.setItem('arcade-sound', e.target.checked);
    if (e.target.checked) {
      initAudio();
      playClickSound();
    }
  });
}

function setupAudioInitTrigger() {
  // Init audio context on first user click/interaction
  const handleInteraction = () => {
    if (!audioInitialized) {
      initAudio();
      playBootSound();
      audioInitialized = true;
      
      // Remove triggers
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    }
  };
  window.addEventListener('click', handleInteraction);
  window.addEventListener('keydown', handleInteraction);
}

/* ==========================================================================
   CHIP-8 EMULATOR HANDLERS
   ========================================================================== */

function setupChip8Controls() {
  // Power Toggle Button
  btnPower.addEventListener('click', () => {
    playClickSound();
    if (cpu.isPowered) {
      // Power off
      playPowerOffSound();
      cpu.isPowered = false;
      cpu.isPaused = false;
      stopChip8Beep();
      cpuStatusIndicator.textContent = "OFFLINE";
      cpuStatusIndicator.className = "stat-value";
      btnPower.classList.remove('btn-danger');
      btnPower.classList.add('btn-secondary');
      
      // Trigger collapse animation on screen
      screenPowerOffOverlay.className = "screen-state-overlay";
      screenPowerOffOverlay.offsetHeight; // force reflow
      screenPowerOffOverlay.classList.add('power-off-anim');
      
      footerStatusText.textContent = "CPU STANDBY";
    } else {
      // Power on
      cpu.isPowered = true;
      cpuStatusIndicator.textContent = "ONLINE";
      cpuStatusIndicator.className = "stat-value active";
      btnPower.classList.remove('btn-secondary');
      btnPower.classList.add('btn-danger');
      
      screenPowerOffOverlay.className = "screen-state-overlay hidden";
      
      // Reset CPU to run loaded ROM
      cpu.reset();
      playBootSound();
      
      footerStatusText.textContent = "RUNNING";
    }
    
    btnPause.textContent = "⏸️ PAUSE";
    btnPause.disabled = !cpu.isPowered;
    btnStep.disabled = true;
    updateDebuggerValues();
  });

  // Pause/Resume Button
  btnPause.addEventListener('click', () => {
    if (!cpu.isPowered) return;
    
    playClickSound();
    cpu.isPaused = !cpu.isPaused;
    
    if (cpu.isPaused) {
      btnPause.textContent = "▶️ RESUME";
      btnPause.classList.remove('btn-warning');
      btnPause.classList.add('btn-primary');
      btnStep.disabled = false;
      footerStatusText.textContent = "PAUSED";
    } else {
      btnPause.textContent = "⏸️ PAUSE";
      btnPause.classList.remove('btn-primary');
      btnPause.classList.add('btn-warning');
      btnStep.disabled = true;
      footerStatusText.textContent = "RUNNING";
    }
  });

  // Single step instruction
  btnStep.addEventListener('click', () => {
    if (!cpu.isPowered || !cpu.isPaused) return;
    playClickSound();
    
    // Timer decrement standard at 60Hz - since we are stepping manually, we manually tick timers if DT/ST > 0
    cpu.cycle();
    cpu.updateTimers();
    
    if (cpu.soundFlag) {
      startChip8Beep();
      setTimeout(stopChip8Beep, 100);
    }
    
    if (cpu.drawFlag) {
      display.render(cpu.display);
      cpu.drawFlag = false;
    }
    
    updateDebuggerValues();
  });

  // Reset Button
  btnReset.addEventListener('click', () => {
    if (!cpu.isPowered) return;
    playClickSound();
    playBootSound();
    cpu.reset();
    
    btnPause.textContent = "⏸️ PAUSE";
    btnPause.classList.remove('btn-primary');
    btnPause.classList.add('btn-warning');
    btnPause.disabled = false;
    btnStep.disabled = true;
    footerStatusText.textContent = "RUNNING";
    
    updateDebuggerValues();
  });

  // Speed Slider
  speedSlider.addEventListener('input', (e) => {
    instructionsPerFrame = parseInt(e.target.value);
    speedValue.textContent = instructionsPerFrame;
  });

  // Custom ROM file selection
  chip8FileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    playClickSound();
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      const romData = new Uint8Array(buffer);
      
      cpu.loadROM(romData);
      
      // Power UI adjustments
      cpu.isPowered = true;
      cpu.isPaused = false;
      cpuStatusIndicator.textContent = "ONLINE";
      cpuStatusIndicator.className = "stat-value active";
      
      btnPower.classList.remove('btn-secondary');
      btnPower.classList.add('btn-danger');
      btnPause.textContent = "⏸️ PAUSE";
      btnPause.disabled = false;
      btnStep.disabled = true;
      
      screenPowerOffOverlay.className = "screen-state-overlay hidden";
      
      // Update names
      footerRomName.textContent = `ROM: ${file.name.toUpperCase()}`;
      footerStatusText.textContent = "RUNNING";
      playBootSound();
      
      // Update Game library buttons active state
      document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
      
      updateDebuggerValues();
    };
    reader.readAsArrayBuffer(file);
  });
}

function buildChip8GameLibrary() {
  gameListContainer.innerHTML = '';
  
  for (const name of Object.keys(BUILTIN_ROMS)) {
    const btn = document.createElement('button');
    btn.className = 'game-btn';
    btn.textContent = name.toUpperCase();
    
    btn.addEventListener('click', () => {
      playClickSound();
      
      // Remove active classes
      document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const romData = BUILTIN_ROMS[name];
      cpu.loadROM(romData);
      
      // Align power UI
      cpu.isPowered = true;
      cpu.isPaused = false;
      cpuStatusIndicator.textContent = "ONLINE";
      cpuStatusIndicator.className = "stat-value active";
      
      btnPower.classList.remove('btn-secondary');
      btnPower.classList.add('btn-danger');
      btnPause.textContent = "⏸️ PAUSE";
      btnPause.disabled = false;
      btnStep.disabled = true;
      
      screenPowerOffOverlay.className = "screen-state-overlay hidden";
      
      footerRomName.textContent = `ROM: BUILT-IN [${name.toUpperCase()}]`;
      footerStatusText.textContent = "RUNNING";
      
      playBootSound();
      updateDebuggerValues();
    });
    
    gameListContainer.appendChild(btn);
  }
}

/* ==========================================================================
   DEBUGGER INTERFACE
   ========================================================================== */

function setupDebuggerUI() {
  // Build initial V0-VF elements in grid
  regsGrid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const box = document.createElement('div');
    box.className = 'reg-box';
    box.id = `reg-box-${i}`;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'reg-name';
    nameSpan.textContent = `V${i.toString(16).toUpperCase()}`;
    
    const valSpan = document.createElement('span');
    valSpan.className = 'reg-val';
    valSpan.id = `reg-val-${i}`;
    valSpan.textContent = '0x00';
    
    box.appendChild(nameSpan);
    box.appendChild(valSpan);
    regsGrid.appendChild(box);
  }
  updateDebuggerValues();
}

function updateDebuggerValues() {
  // V-Registers
  for (let i = 0; i < 16; i++) {
    const valSpan = document.getElementById(`reg-val-${i}`);
    const box = document.getElementById(`reg-box-${i}`);
    const valHex = `0x${cpu.v[i].toString(16).padStart(2, '0').toUpperCase()}`;
    
    if (valSpan.textContent !== valHex) {
      valSpan.textContent = valHex;
      // Highlight modified values
      if (cpu.modifiedRegs.has(i)) {
        box.classList.add('changed');
        setTimeout(() => box.classList.remove('changed'), 400);
      }
    }
  }

  // Pointers
  ptrPc.textContent = `0x${cpu.pc.toString(16).padStart(3, '0').toUpperCase()}`;
  ptrI.textContent = `0x${cpu.i.toString(16).padStart(3, '0').toUpperCase()}`;
  ptrSp.textContent = `0x${cpu.sp.toString(16).toUpperCase()}`;
  ptrDt.textContent = cpu.dt.toString().padStart(2, '0');
  ptrSt.textContent = cpu.st.toString().padStart(2, '0');
  
  // Highlighting ST indicator glow (flashing sound active)
  const dtVal = parseInt(ptrDt.textContent);
  const stVal = parseInt(ptrSt.textContent);
  
  // Re-build disassembly lines
  const windowList = cpu.getDisassemblyWindow();
  disasmList.innerHTML = '';
  
  windowList.forEach(item => {
    const line = document.createElement('div');
    line.className = `disasm-line ${item.isCurrent ? 'current' : ''}`;
    
    const pcSpan = document.createElement('span');
    pcSpan.className = 'disasm-pc';
    pcSpan.textContent = item.addr;
    
    const opSpan = document.createElement('span');
    opSpan.className = 'disasm-op';
    opSpan.textContent = item.raw;
    
    const descSpan = document.createElement('span');
    descSpan.className = 'disasm-desc';
    descSpan.textContent = item.desc;
    
    line.appendChild(pcSpan);
    line.appendChild(opSpan);
    line.appendChild(descSpan);
    disasmList.appendChild(line);
  });
}

/* ==========================================================================
   MULTI-SYSTEM CONSOLE PLAYER (DRAG & DROP)
   ========================================================================== */

function setupConsolePlayer() {
  // Drag over
  consoleDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    consoleDropZone.classList.add('dragover');
  });

  // Drag leave
  consoleDropZone.addEventListener('dragleave', () => {
    consoleDropZone.classList.remove('dragover');
  });

  // Drop
  consoleDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    consoleDropZone.classList.remove('dragover');
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleConsoleROMFile(file);
    }
  });

  // Select File Dialog
  consoleDropZone.addEventListener('click', () => {
    consoleFileInput.click();
  });

  consoleFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleConsoleROMFile(file);
    }
  });

  // Exit Player Button
  btnClosePlayer.addEventListener('click', () => {
    playClickSound();
    unloadConsolePlayer();
  });
}

function handleConsoleROMFile(file) {
  playClickSound();
  emuLoadingOverlay.classList.remove('hidden');
  
  try {
    const coreName = loadConsoleROM(file, emuCanvasHost);
    
    // Wait slightly to hide loader (feels like loading BIOS)
    setTimeout(() => {
      emuLoadingOverlay.classList.add('hidden');
      consoleWelcome.classList.add('hidden');
      emuPlayerContainer.classList.remove('hidden');
      
      playerTitle.textContent = `NOW PLAYING: ${file.name.toUpperCase()} [${coreName}]`;
      footerRomName.textContent = `ROM: ${file.name.toUpperCase()}`;
      footerStatusText.textContent = `RUNNING [${coreName}]`;
    }, 1200);

  } catch (err) {
    emuLoadingOverlay.classList.add('hidden');
    alert(err.message);
  }
}

function unloadConsolePlayer() {
  unloadConsoleROM();
  consoleWelcome.classList.remove('hidden');
  emuPlayerContainer.classList.add('hidden');
  
  // Clear file input
  consoleFileInput.value = '';
  
  footerRomName.textContent = "ROM: NONE LOADED";
  footerStatusText.textContent = "SYSTEM READY";
}

/* ==========================================================================
   KEY BINDING EDITOR GUI
   ========================================================================== */

function buildKeypadEditor() {
  // 1. Generate visual pad
  hexKeypadGrid.innerHTML = '';
  // Key order for standard Chip-8 4x4 keypad grid layout:
  // 1 2 3 C
  // 4 5 6 D
  // 7 8 9 E
  // A 0 B F
  const keyOrder = [
    0x1, 0x2, 0x3, 0xC,
    0x4, 0x5, 0x6, 0xD,
    0x7, 0x8, 0x9, 0xE,
    0xA, 0x0, 0xB, 0xF
  ];

  keyOrder.forEach(keyIndex => {
    const btn = document.createElement('button');
    btn.className = 'hex-key-btn';
    btn.id = `key-btn-${keyIndex}`;
    
    const hexLabel = document.createElement('span');
    hexLabel.textContent = keyIndex.toString(16).toUpperCase();
    
    const pcLabel = document.createElement('span');
    pcLabel.className = 'key-map-hint';
    pcLabel.id = `key-hint-${keyIndex}`;
    pcLabel.textContent = keyboard.getKeyDisplay(keyIndex);
    
    btn.appendChild(hexLabel);
    btn.appendChild(pcLabel);
    
    // Click key to start rebinding flow
    btn.addEventListener('click', () => {
      startRebindingFlow(keyIndex);
    });
    
    hexKeypadGrid.appendChild(btn);
  });

  // 2. Generate table mapping list
  buildKeymapList();
}

function buildKeymapList() {
  keymapList.innerHTML = '';
  
  for (let keyVal = 0; keyVal < 16; keyVal++) {
    const row = document.createElement('div');
    row.className = 'keymap-row';
    
    const chip8Col = document.createElement('span');
    chip8Col.className = 'keymap-row-chip8';
    chip8Col.textContent = `KEY ${keyVal.toString(16).toUpperCase()}`;
    
    const arrowCol = document.createElement('span');
    arrowCol.textContent = '➡️';
    
    const pcCol = document.createElement('span');
    pcCol.className = 'keymap-row-pc';
    pcCol.id = `keymap-row-pc-${keyVal}`;
    pcCol.textContent = keyboard.getKeyDisplay(keyVal);
    
    row.appendChild(chip8Col);
    row.appendChild(arrowCol);
    row.appendChild(pcCol);
    
    keymapList.appendChild(row);
  }
}

function startRebindingFlow(keyIndex) {
  playClickSound();
  
  // Cancel previous rebind state
  if (isRebindingKey !== null) {
    const prevBtn = document.getElementById(`key-btn-${isRebindingKey}`);
    if (prevBtn) prevBtn.classList.remove('rebinding');
  }

  isRebindingKey = keyIndex;
  const btn = document.getElementById(`key-btn-${keyIndex}`);
  btn.classList.add('rebinding');
  
  const hint = document.getElementById(`key-hint-${keyIndex}`);
  hint.textContent = 'PRESS KEY';
  
  // Add temporary window listener for next keydown
  const captureRebind = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Bind key in helper
    keyboard.bindKey(keyIndex, e.code);
    playClickSound();
    
    // Save to localStorage
    saveKeyBindings();
    
    // Cleanup
    btn.classList.remove('rebinding');
    isRebindingKey = null;
    window.removeEventListener('keydown', captureRebind, true);
    
    // Rebuild UI representations
    buildKeypadEditor();
  };
  
  // Register with capture priority (true) to intercept inputs before other elements
  window.addEventListener('keydown', captureRebind, true);
}

function saveKeyBindings() {
  // Serialize pcToChip8Map to save
  const data = JSON.stringify(keyboard.pcToChip8Map);
  localStorage.setItem('arcade-keymaps', data);
}

function loadSavedKeyBindings() {
  const data = localStorage.getItem('arcade-keymaps');
  if (data) {
    try {
      const parsed = JSON.parse(data);
      keyboard.pcToChip8Map = parsed;
      // Rebuild reverse map
      keyboard.chip8ToPcMap = {};
      for (const [pcCode, chipVal] of Object.entries(parsed)) {
        keyboard.chip8ToPcMap[chipVal] = pcCode;
      }
    } catch (e) {
      console.error("Error loading keymaps:", e);
    }
  }
}

// Reset Defaults
btnResetKeys.addEventListener('click', () => {
  playClickSound();
  keyboard.resetDefaults();
  localStorage.removeItem('arcade-keymaps');
  buildKeypadEditor();
});

function flashKeypadGUI(keyIndex) {
  const btn = document.getElementById(`key-btn-${keyIndex}`);
  if (btn) {
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 120);
  }
}

// Load custom mappings on init
loadSavedKeyBindings();

// Start
init();
