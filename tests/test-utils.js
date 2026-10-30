/**
 * Timestamp Camera Web — Test Utilities, Headless Mocks & Assertions
 * Pure zero-dependency Node.js test helpers.
 */

import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// ==========================================
// 1. Reference Constants & Specifications
// ==========================================
export const REFERENCE_SPECS = {
  // Authoritative reference photo values (from media_1793282555436_8b59e9be.jpg)
  image: {
    width: 1024,
    height: 768,
    minDim: 768,
    format: 'JPEG'
  },
  watermark: {
    line1Date: '28 ต.ค. 2569 21:12:07',
    line2Coords: '+6.499413,+101.267206',
    line3Address: 'อ.เมืองยะลา, จ.ยะลา',
    date: new Date(2026, 9, 28, 21, 12, 7), // 28 Oct 2026
    lat: 6.499413,
    lon: 101.267206,
    // Optical dimensions measured from reference photo
    fontSizePx: 28,
    lineHeightPx: 36,
    marginRightPx: 35,
    marginBottomPx: 36,
    // Proportional formulas relative to minDim = Math.min(width, height)
    fontScaleFactor: 0.0365, // 28 / 768 ≈ 0.0365
    lineHeightRatio: 1.30,   // 36 / 28 ≈ 1.285 - 1.30
    marginRightFactor: 0.046, // 35 / 768 ≈ 0.0456
    marginBottomFactor: 0.047 // 36 / 768 ≈ 0.0469
  },
  thaiMonths: [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ]
};

// ==========================================
// 2. Dynamic Module Loader
// ==========================================
/**
 * Safely imports a module from the js/ directory.
 * If file does not exist, returns { exists: false, error: err, module: null }
 * allowing tests to report specific interface status without crashing Node.
 */
export async function loadModule(moduleFileName) {
  const fullPath = path.resolve(PROJECT_ROOT, 'js', moduleFileName);
  if (!fs.existsSync(fullPath)) {
    return {
      exists: false,
      path: fullPath,
      module: null,
      error: new Error(`Module file not found: js/${moduleFileName}`)
    };
  }
  try {
    const fileUrl = url.pathToFileURL(fullPath).href;
    const mod = await import(fileUrl);
    return {
      exists: true,
      path: fullPath,
      module: mod,
      error: null
    };
  } catch (err) {
    return {
      exists: true,
      path: fullPath,
      module: null,
      error: err
    };
  }
}

// ==========================================
// 3. Headless Canvas & 2D Context Mock
// ==========================================
export class MockContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.font = '10px sans-serif';
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.shadowColor = 'transparent';
    this.shadowBlur = 0;
    this.shadowOffsetX = 0;
    this.shadowOffsetY = 0;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.globalAlpha = 1.0;
    
    this.calls = [];
    this._saveStack = [];
  }

  save() {
    this.calls.push({ method: 'save' });
    this._saveStack.push({
      font: this.font,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY
    });
  }

  restore() {
    this.calls.push({ method: 'restore' });
    if (this._saveStack.length > 0) {
      const state = this._saveStack.pop();
      Object.assign(this, state);
    }
  }

  clearRect(x, y, w, h) {
    this.calls.push({ method: 'clearRect', args: { x, y, w, h } });
  }

  fillRect(x, y, w, h) {
    this.calls.push({ method: 'fillRect', args: { x, y, w, h } });
  }

  strokeRect(x, y, w, h) {
    this.calls.push({ method: 'strokeRect', args: { x, y, w, h } });
  }

  /** Right edge of a recorded fillText/strokeText call, whatever its textAlign. */
  static rightEdge(call) {
    const { text, x } = call.args;
    const { textAlign, font } = call.state;
    if (textAlign === 'right' || textAlign === 'end') return x;
    const match = (font || '').match(/(\d+(?:\.\d+)?)px/);
    const size = match ? parseFloat(match[1]) : 28;
    return x + (text || '').length * (size * 0.55);
  }

  fillText(text, x, y, maxWidth) {
    this.calls.push({
      method: 'fillText',
      args: { text, x, y, maxWidth },
      state: {
        font: this.font,
        fillStyle: this.fillStyle,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        shadowColor: this.shadowColor,
        shadowBlur: this.shadowBlur
      }
    });
  }

  strokeText(text, x, y, maxWidth) {
    this.calls.push({
      method: 'strokeText',
      args: { text, x, y, maxWidth },
      state: {
        font: this.font,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        shadowColor: this.shadowColor,
        shadowBlur: this.shadowBlur
      }
    });
  }

  measureText(text) {
    this.calls.push({ method: 'measureText', args: { text } });
    // Approximate Sarabun font metrics based on font size in string
    const match = (this.font || '').match(/(\d+(?:\.\d+)?)px/);
    const size = match ? parseFloat(match[1]) : 28;
    return {
      width: (text || '').length * (size * 0.55),
      actualBoundingBoxAscent: size * 0.8,
      actualBoundingBoxDescent: size * 0.2
    };
  }

  drawImage(image, ...args) {
    this.calls.push({ method: 'drawImage', args: { image, rest: args } });
  }

  beginPath() {
    this.calls.push({ method: 'beginPath' });
  }

  closePath() {
    this.calls.push({ method: 'closePath' });
  }

  moveTo(x, y) {
    this.calls.push({ method: 'moveTo', args: { x, y } });
  }

  lineTo(x, y) {
    this.calls.push({ method: 'lineTo', args: { x, y } });
  }

  stroke() {
    this.calls.push({ method: 'stroke' });
  }

  fill() {
    this.calls.push({ method: 'fill' });
  }

  getCalls(methodName) {
    return this.calls.filter(c => !methodName || c.method === methodName);
  }

  clearCalls() {
    this.calls = [];
  }
}

export class MockCanvas {
  constructor(width = 1024, height = 768) {
    this.width = width;
    this.height = height;
    this._ctx = new MockContext2D(this);
  }

  getContext(type) {
    if (type === '2d') {
      return this._ctx;
    }
    return null;
  }

  toBlob(callback, type = 'image/jpeg', quality = 0.95) {
    const fakeBuffer = Buffer.from(`MOCK_IMAGE_BLOB_${this.width}x${this.height}_${type}_${quality}`);
    const blob = {
      size: fakeBuffer.length,
      type,
      arrayBuffer: async () => fakeBuffer.buffer
    };
    if (callback) {
      setTimeout(() => callback(blob), 0);
    }
    return Promise.resolve(blob);
  }

  toDataURL(type = 'image/jpeg', quality = 0.95) {
    return `data:${type};base64,TU9DS19EQVRBX1VSTF8ke3RoaXMud2lkdGh9eCR7dGhpcy5oZWlnaHR9`;
  }
}

// ==========================================
// 4. In-Memory LocalStorage Mock
// ==========================================
export class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get length() {
    return this.store.size;
  }

  key(index) {
    return Array.from(this.store.keys())[index] || null;
  }
}

export function setMockNavigator(mockNav) {
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNav,
      configurable: true,
      writable: true
    });
  } catch (e) {
    globalThis.navigator = mockNav;
  }
}

export function setMockLocalStorage(mockStore) {
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStore,
      configurable: true,
      writable: true
    });
  } catch (e) {
    globalThis.localStorage = mockStore;
  }
}

// ==========================================
// 5. Assertions Library
// ==========================================
export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    const err = new Error(message);
    Error.captureStackTrace(err, assert);
    throw err;
  }
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    const msg = message ? `${message} | ` : '';
    const err = new Error(`${msg}Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
    Error.captureStackTrace(err, assertEqual);
    throw err;
  }
}

export function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    const msg = message ? `${message} | ` : '';
    const err = new Error(`${msg}Deep equality mismatch:\nExpected: ${expectedStr}\nActual:   ${actualStr}`);
    Error.captureStackTrace(err, assertDeepEqual);
    throw err;
  }
}

export function assertMatch(str, regex, message) {
  if (!regex.test(str)) {
    const msg = message ? `${message} | ` : '';
    const err = new Error(`${msg}String "${str}" does not match regex ${regex}`);
    Error.captureStackTrace(err, assertMatch);
    throw err;
  }
}

export function assertThrows(fn, expectedRegexOrMessage, message) {
  let threw = false;
  let thrownError = null;
  try {
    fn();
  } catch (err) {
    threw = true;
    thrownError = err;
  }
  if (!threw) {
    const msg = message ? `${message} | ` : '';
    throw new Error(`${msg}Expected function to throw, but it returned successfully`);
  }
  if (expectedRegexOrMessage instanceof RegExp) {
    assertMatch(thrownError.message || String(thrownError), expectedRegexOrMessage, message);
  } else if (typeof expectedRegexOrMessage === 'string') {
    assert(
      (thrownError.message || '').includes(expectedRegexOrMessage),
      `Expected error containing "${expectedRegexOrMessage}", got "${thrownError.message}"`
    );
  }
}

export async function assertRejects(asyncFn, message) {
  let threw = false;
  try {
    await asyncFn();
  } catch (err) {
    threw = true;
  }
  if (!threw) {
    const msg = message ? `${message} | ` : '';
    throw new Error(`${msg}Expected promise to reject, but it resolved`);
  }
}

export function assertBetween(val, min, max, message) {
  if (val < min || val > max) {
    const msg = message ? `${message} | ` : '';
    throw new Error(`${msg}Value ${val} not in range [${min}, ${max}]`);
  }
}
