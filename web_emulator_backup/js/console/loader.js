/* ==========================================================================
   AURA ARCADE - MULTI-SYSTEM RETRO CONSOLE LOADER (EMULATORJS)
   ========================================================================== */

let activeIframe = null;
let activeObjectUrl = null;

// Map file extensions to EmulatorJS Core Names
const CORE_MAPPING = {
  'nes': 'nes',
  'gb': 'gb',
  'gbc': 'gbc',
  'gba': 'gba',
  'bin': 'segaMD',
  'smd': 'segaMD'
};

/**
 * Parses file extension from filename.
 */
function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

/**
 * Loads a local ROM file into an isolated iframe player using EmulatorJS.
 * Isolating inside an iframe prevents global event listener contamination
 * and memory leaks when switching or exiting games.
 * 
 * @param {File} file - Local ROM File from drag-and-drop or file selector
 * @param {HTMLElement} hostElement - Container element to mount player
 * @returns {string} Core system name loaded
 */
export function loadConsoleROM(file, hostElement) {
  // 1. Cleanup any existing player
  unloadConsoleROM();

  const ext = getExtension(file.name);
  const core = CORE_MAPPING[ext];
  
  if (!core) {
    throw new Error(`Unsupported console extension: .${ext}`);
  }

  // 2. Create Blob URL for local ROM file
  activeObjectUrl = URL.createObjectURL(file);

  // 3. Create active player iframe
  activeIframe = document.createElement('iframe');
  activeIframe.style.width = '100%';
  activeIframe.style.height = '100%';
  activeIframe.style.border = 'none';
  activeIframe.setAttribute('allow', 'gamepad; autoplay; fullscreen');
  
  hostElement.appendChild(activeIframe);

  // 4. Construct content inside IFrame
  const iframeContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background-color: #000;
        }
        #game {
          width: 100%;
          height: 100%;
        }
      </style>
    </head>
    <body>
      <div id="game"></div>
      <script>
        // EmulatorJS Configurations
        window.EJS_player = '#game';
        window.EJS_core = '${core}';
        window.EJS_gameUrl = '${activeObjectUrl}';
        window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
        window.EJS_startOnLoaded = true;
      </script>
      <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
    </body>
    </html>
  `;

  // Write content to iframe document
  const doc = activeIframe.contentWindow.document;
  doc.open();
  doc.write(iframeContent);
  doc.close();

  return core.toUpperCase();
}

/**
 * Destroys the active player, frees the ROM Blob URL,
 * and clears DOM nodes to reclaim memory.
 */
export function unloadConsoleROM() {
  if (activeIframe) {
    activeIframe.remove();
    activeIframe = null;
  }
  
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}
