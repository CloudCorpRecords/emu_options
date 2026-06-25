/* ==========================================================================
   AURA ARCADE - CHIP-8 DISPLAY RENDERER
   ========================================================================== */

// Palette definition for active pixel vs background pixel in each theme
const THEME_PALETTES = {
  'theme-synthwave': {
    bg: '#1c0e2d',
    pixel: '#00f0ff',
    glow: 'rgba(0, 240, 255, 0.6)'
  },
  'theme-cyberpunk': {
    bg: '#061109',
    pixel: '#00ff41',
    glow: 'rgba(0, 255, 65, 0.7)'
  },
  'theme-glacier': {
    bg: '#0d1b2a',
    pixel: '#90e0ef',
    glow: 'rgba(144, 224, 239, 0.5)'
  },
  'theme-gameboy': {
    bg: '#9bbc0f',
    pixel: '#0f380f',
    glow: 'rgba(15, 56, 15, 0.2)'
  }
};

export class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    this.cols = 64;
    this.rows = 32;
    
    this.currentTheme = 'theme-synthwave';
    
    // Scale canvas to match bounding container
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Resizes the canvas rendering context sizes.
   */
  resize() {
    // Canvas dimensions are fixed internally, CSS stretches them,
    // but we want crisp rendering, so we align internal buffer
    this.scaleX = this.canvas.width / this.cols;
    this.scaleY = this.canvas.height / this.rows;
  }

  /**
   * Updates current active theme palette.
   */
  setTheme(themeName) {
    if (THEME_PALETTES[themeName]) {
      this.currentTheme = themeName;
    }
  }

  /**
   * Clears canvas with the theme background color.
   */
  clear() {
    const palette = THEME_PALETTES[this.currentTheme] || THEME_PALETTES['theme-synthwave'];
    this.ctx.fillStyle = palette.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Renders the 64x32 CPU display buffer onto the canvas.
   * Includes retro sub-grids, scanlines, and pixel glow shadows.
   */
  render(displayBuffer) {
    const palette = THEME_PALETTES[this.currentTheme] || THEME_PALETTES['theme-synthwave'];
    
    // 1. Draw background
    this.clear();
    
    this.ctx.fillStyle = palette.pixel;
    
    // Setup drop shadow blur for glowing CRT look (except on Game Boy DMG theme)
    if (this.currentTheme !== 'theme-gameboy') {
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = palette.glow;
    } else {
      this.ctx.shadowBlur = 0;
    }

    // 2. Draw active pixels
    for (let i = 0; i < displayBuffer.length; i++) {
      if (displayBuffer[i] === 1) {
        const x = (i % this.cols) * this.scaleX;
        const y = Math.floor(i / this.cols) * this.scaleY;
        
        // Draw slightly smaller rect to create a pixel-grid structure (looks highly premium!)
        const margin = 0.8; // Gaps
        this.ctx.fillRect(
          x + margin,
          y + margin,
          this.scaleX - margin * 2,
          this.scaleY - margin * 2
        );
      }
    }
    
    // Clear shadow state for next drawing operations
    this.ctx.shadowBlur = 0;
  }
}
