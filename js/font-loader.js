/**
 * Timestamp Camera Web — Typography & Font Delivery Engine
 * js/font-loader.js
 *
 * Manages loading, caching, and readiness verification of the bundled
 * 'Sarabun' Thai sans-serif font for the watermark canvas renderer.
 * Enforces fail-safe timeouts and graceful system fallback on network or rendering issues.
 *
 * Milestone: M2-CANVAS
 */

export const WATERMARK_FONT_FAMILY = 'Sarabun';

export const WATERMARK_FONT_FALLBACK_STACK =
  "'Sarabun', 'Leelawadee UI', 'Thonburi', 'Segoe UI', Tahoma, sans-serif";

export const DEFAULT_FONT_WEIGHT = 500;
export const DEFAULT_FONT_SIZE = 28;
export const DEFAULT_TIMEOUT_MS = 2500;

// Internal cache state
let _fontsReady = false;
let _loadPromise = null;

/**
 * Returns the fallback font stack string.
 * @returns {string}
 */
export function getWatermarkFontStack() {
  return WATERMARK_FONT_FALLBACK_STACK;
}

/**
 * Returns the primary watermark font family.
 * @returns {string}
 */
export function getWatermarkFontFamily() {
  return WATERMARK_FONT_FAMILY;
}

/**
 * Constructs a CSS font descriptor string for Canvas context.
 * @param {number} [fontSize=28] - Font size in pixels
 * @param {number|string} [fontWeight=500] - Font weight (e.g. 400, 500, 'bold')
 * @returns {string}
 */
export function getWatermarkFont(fontSize = DEFAULT_FONT_SIZE, fontWeight = DEFAULT_FONT_WEIGHT) {
  return `${fontWeight} ${Math.round(fontSize)}px ${WATERMARK_FONT_FALLBACK_STACK}`;
}

/**
 * Synchronously checks if a font is already loaded and available in the document.
 * @param {string} [family='Sarabun'] - Font family name
 * @param {number|string} [weight=500] - Font weight
 * @param {number} [size=28] - Font size in pixels
 * @returns {boolean}
 */
export function isFontLoaded(family = WATERMARK_FONT_FAMILY, weight = DEFAULT_FONT_WEIGHT, size = DEFAULT_FONT_SIZE) {
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.check !== 'function') {
    // In headless/Node environment, assume available
    return true;
  }
  try {
    return document.fonts.check(`${weight} ${Math.round(size)}px "${family}"`);
  } catch (err) {
    console.warn('[FontLoader] document.fonts.check error:', err);
    return false;
  }
}

/**
 * Asynchronously loads and verifies the watermark fonts using CSS Font Loading API.
 * Uses Promise.race with a timeout to guarantee the application never freezes or blocks.
 *
 * @param {Object} [options={}]
 * @param {number} [options.timeoutMs=2500] - Timeout in milliseconds before falling back
 * @param {string} [options.family='Sarabun'] - Font family to load
 * @param {Array<number|string>} [options.weights=[400, 500]] - Font weights to preload
 * @param {number} [options.size=28] - Test size in pixels for font check
 * @returns {Promise<boolean>} True if custom font is loaded, false if fallback stack was engaged
 */
export async function loadWatermarkFonts(options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    family = WATERMARK_FONT_FAMILY,
    weights = [400, 500],
    size = DEFAULT_FONT_SIZE
  } = options;

  // Environment guard: Node.js, Web Worker, or unsupported browser
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') {
    _fontsReady = true;
    return true;
  }

  // Fast path: if already cached as ready and check passes, return immediately
  if (_fontsReady && isFontLoaded(family, DEFAULT_FONT_WEIGHT, size)) {
    return true;
  }

  // De-duplicate in-flight loading promises
  if (_loadPromise) {
    return _loadPromise;
  }

  _loadPromise = (async () => {
    // Timeout promise for fail-safe fallback
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        console.warn(
          `[FontLoader] Font loading timed out after ${timeoutMs}ms. Using system fallback: ${WATERMARK_FONT_FALLBACK_STACK}`
        );
        resolve(false);
      }, timeoutMs);
    });

    // Font loading promise
    const loadPromise = (async () => {
      try {
        // Trigger loading for each specified weight
        const loadOps = weights.map((weight) =>
          document.fonts.load(`${weight} ${Math.round(size)}px "${family}"`)
        );

        await Promise.all(loadOps);

        // Await document.fonts.ready for all pending decodes to settle
        if (document.fonts.ready) {
          await document.fonts.ready;
        }

        // Verify with document.fonts.check
        const primaryCheck = isFontLoaded(family, DEFAULT_FONT_WEIGHT, size);
        if (primaryCheck) {
          _fontsReady = true;
          return true;
        } else {
          console.warn(
            `[FontLoader] Font '${family}' loaded but document.fonts.check returned false. Utilizing fallback stack.`
          );
          return false;
        }
      } catch (err) {
        console.warn(`[FontLoader] Error during font loading for '${family}':`, err);
        return false;
      }
    })();

    try {
      const result = await Promise.race([loadPromise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      _loadPromise = null;
    }
  })();

  return _loadPromise;
}

/**
 * Backward-compatible alias for test suites and watermark engine.
 * @param {string} [family='Sarabun']
 * @param {number} [size=28]
 * @param {number|string} [weight=500]
 * @returns {Promise<boolean>}
 */
export async function ensureFontLoaded(family = WATERMARK_FONT_FAMILY, size = DEFAULT_FONT_SIZE, weight = DEFAULT_FONT_WEIGHT) {
  return loadWatermarkFonts({ family, size, weights: [weight] });
}

/**
 * Backward-compatible alias for loading Sarabun specifically.
 * @returns {Promise<boolean>}
 */
export async function loadSarabunFont() {
  return loadWatermarkFonts();
}

/**
 * Resets the internal font cache state (useful for test fixtures).
 */
export function resetFontCache() {
  _fontsReady = false;
  _loadPromise = null;
}
