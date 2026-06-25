/* ==========================================================================
   AURA ARCADE - WEB AUDIO SYNTHESIZER
   ========================================================================== */

let audioCtx = null;
let masterGain = null;
let isMuted = false;
let activeBeepOsc = null;

/**
 * Initializes the Web Audio Context. Must be called after a user gesture.
 */
export function initAudio() {
  if (audioCtx) return;
  
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    
    // Create master gain control
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(isMuted ? 0 : 0.15, audioCtx.currentTime); // Low default volume for comfort
    masterGain.connect(audioCtx.destination);
  } catch (e) {
    console.error("Failed to initialize Web Audio API:", e);
  }
}

/**
 * Mutes or unmutes the audio system.
 */
export function setMute(mute) {
  isMuted = mute;
  if (masterGain && audioCtx) {
    masterGain.gain.setValueAtTime(isMuted ? 0 : 0.15, audioCtx.currentTime);
  }
}

/**
 * Helper to ensure AudioContext is active (handles browser suspension)
 */
async function resumeContext() {
  if (!audioCtx) initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
}

/**
 * Plays a quick menu click sound (short retro beep).
 */
export async function playClickSound() {
  if (isMuted) return;
  await resumeContext();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);

  gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.06);
}

/**
 * Plays a retro boot chime (synthesized classic arpeggio).
 */
export async function playBootSound() {
  if (isMuted) return;
  await resumeContext();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5 (major chord)
  
  notes.forEach((freq, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now + index * 0.08);

    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0.3, now + index * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.005, now + index * 0.08 + 0.3);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now + index * 0.08);
    osc.stop(now + index * 0.08 + 0.35);
  });
}

/**
 * Plays a retro power-off frequency sweep.
 */
export async function playPowerOffSound() {
  if (isMuted) return;
  await resumeContext();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.linearRampToValueAtTime(40, now + 0.35);

  gain.gain.setValueAtTime(0.6, now);
  gain.gain.linearRampToValueAtTime(0.01, now + 0.35);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start();
  osc.stop(now + 0.4);
}

/**
 * Plays a tab change sound.
 */
export async function playTabSound() {
  if (isMuted) return;
  await resumeContext();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.12);

  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.13);
}

/**
 * Starts a continuous beep for the Chip-8 Sound Timer.
 */
export async function startChip8Beep() {
  if (isMuted || activeBeepOsc) return;
  await resumeContext();
  if (!audioCtx) return;

  try {
    activeBeepOsc = audioCtx.createOscillator();
    const beepGain = audioCtx.createGain();
    
    // Chip-8 beep has a classic, raw square-wave retro timbre
    activeBeepOsc.type = 'square';
    activeBeepOsc.frequency.setValueAtTime(370, audioCtx.currentTime); // Standard 370Hz retro tone
    
    beepGain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    
    activeBeepOsc.connect(beepGain);
    beepGain.connect(masterGain);
    
    activeBeepOsc.start();
  } catch (e) {
    console.error("Error starting beep:", e);
  }
}

/**
 * Stops the continuous Chip-8 beep.
 */
export function stopChip8Beep() {
  if (activeBeepOsc) {
    try {
      activeBeepOsc.stop();
    } catch (e) {}
    activeBeepOsc = null;
  }
}
