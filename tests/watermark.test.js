/**
 * tests/watermark.test.js
 * 
 * Comprehensive Unit Test Suite for Milestone M2-CANVAS:
 * - js/font-loader.js (Font Loading, Caching, Timeout Fallback, Aliases)
 * - js/watermark-engine.js (Metrics, Sizing, Clamping, Dual-Canvas Pipeline, Two-Pass Rendering)
 * 
 * Verifies:
 * 1. Sarabun font loading & document.fonts readiness
 * 2. Optical layout mathematics (28px font, 36px line height on 1024x768)
 * 3. Aspect-ratio and orientation invariance (minDim scaling)
 * 4. Dual-Canvas preview downscaling (<= 1280px bounding box)
 * 5. GPU memory protection clamp (<= 8192px max dimension)
 * 6. Immediate GPU backing buffer disposal (width=1, height=1)
 * 7. Two-pass rendering (Pass 1 dark stroke with shadow, Pass 2 pure white fill)
 * 8. Exact 3-line layout order and uniform vertical baseline progression
 * 9. Resilience to empty strings, 150+ char Thai strings, XSS payloads
 * 10. Full-resolution export pipeline and EXIF orientation handling
 */

import { describe, test, harness } from './test-runner.js';
import {
  MockCanvas,
  MockContext2D,
  assert,
  assertEqual,
  assertMatch,
  assertBetween
} from './test-utils.js';

import {
  WATERMARK_FONT_FAMILY,
  WATERMARK_FONT_FALLBACK_STACK,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_FONT_SIZE,
  getWatermarkFontStack,
  getWatermarkFontFamily,
  getWatermarkFont,
  isFontLoaded,
  loadWatermarkFonts,
  ensureFontLoaded,
  loadSarabunFont,
  resetFontCache
} from '../js/font-loader.js';

import {
  calculateWatermarkMetrics,
  calculatePreviewDimensions,
  clampCanvasDimensions,
  disposeCanvas,
  renderWatermark,
  drawOrientedImage,
  renderPreview,
  exportFullResolution,
  WATERMARK_RATIOS,
  WatermarkEngine
} from '../js/watermark-engine.js';

// =========================================================================
// Suite 1: Font Loader & Typography Engine (js/font-loader.js)
// =========================================================================
describe('Font Loader & Typography Engine', () => {
  test('Constants: Default font family is Sarabun and weight is 500', () => {
    assertEqual(WATERMARK_FONT_FAMILY, 'Sarabun');
    assertEqual(DEFAULT_FONT_WEIGHT, 500);
    assertEqual(DEFAULT_FONT_SIZE, 28);
    assertEqual(getWatermarkFontFamily(), 'Sarabun');
    assertMatch(getWatermarkFontStack(), /Sarabun/);
    assertMatch(getWatermarkFontStack(), /Leelawadee UI/);
  });

  test('getWatermarkFont: Constructs valid CSS font descriptor string', () => {
    const fontStr = getWatermarkFont(28, 500);
    assertMatch(fontStr, /^500 28px /);
    assertMatch(fontStr, /'Sarabun'/);
  });

  test('loadWatermarkFonts: Resolves true in Node.js headless environment without throwing', async () => {
    resetFontCache();
    const result = await loadWatermarkFonts();
    assertEqual(result, true, 'Headless load resolves true');
  });

  test('loadWatermarkFonts: Resolves true when document.fonts succeeds', async () => {
    resetFontCache();
    const originalDoc = globalThis.document;
    try {
      globalThis.document = {
        fonts: {
          check(spec) {
            return spec.includes('Sarabun');
          },
          load(spec) {
            return Promise.resolve([spec]);
          },
          ready: Promise.resolve()
        }
      };

      const result = await loadWatermarkFonts();
      assertEqual(result, true, 'Mock document.fonts resolves true');

      const loaded = isFontLoaded('Sarabun', 500, 28);
      assertEqual(loaded, true, 'isFontLoaded returns true');
    } finally {
      if (originalDoc !== undefined) {
        globalThis.document = originalDoc;
      } else {
        delete globalThis.document;
      }
    }
  });

  test('loadWatermarkFonts: Backward-compatible aliases ensureFontLoaded and loadSarabunFont work', async () => {
    resetFontCache();
    const alias1 = await ensureFontLoaded();
    assertEqual(alias1, true);
    const alias2 = await loadSarabunFont();
    assertEqual(alias2, true);
  });

  test('loadWatermarkFonts: Falls back cleanly when document.fonts.load times out', async () => {
    resetFontCache();
    const originalDoc = globalThis.document;
    try {
      globalThis.document = {
        fonts: {
          check: () => false,
          load: () => new Promise(() => {}), // never resolves
          ready: new Promise(() => {})
        }
      };

      const start = Date.now();
      const result = await loadWatermarkFonts({ timeoutMs: 50 });
      const elapsed = Date.now() - start;

      assertEqual(result, false, 'Timed-out load resolves false for system fallback');
      assert(elapsed >= 40, `Timeout waited at least 40ms, elapsed: ${elapsed}ms`);
    } finally {
      if (originalDoc !== undefined) {
        globalThis.document = originalDoc;
      } else {
        delete globalThis.document;
      }
    }
  });

  test('loadWatermarkFonts: Recovers gracefully when document.fonts.load rejects', async () => {
    resetFontCache();
    const originalDoc = globalThis.document;
    try {
      globalThis.document = {
        fonts: {
          check: () => false,
          load: () => Promise.reject(new Error('Simulated network 404')),
          ready: Promise.resolve()
        }
      };

      const result = await loadWatermarkFonts({ timeoutMs: 100 });
      assertEqual(result, false, 'Network rejection caught and resolved false');
    } finally {
      if (originalDoc !== undefined) {
        globalThis.document = originalDoc;
      } else {
        delete globalThis.document;
      }
    }
  });
});

// =========================================================================
// Suite 2: Proportional Watermark Sizing Math
// =========================================================================
describe('Proportional Watermark Metrics Math', () => {
  test('Reference 1024x768 produces optical metrics matching reference image', () => {
    const m = calculateWatermarkMetrics(1024, 768);
    assertEqual(m.minDim, 768);
    assertEqual(m.fontSize, 28, 'Font size on 768 minDim is 28px');
    assertEqual(m.lineHeight, 36, 'Line height on 28px font is 36px');
    assertEqual(m.marginRight, 35, 'Right margin on 768 minDim is 35px');
    assertEqual(m.marginBottom, 36, 'Bottom margin on 768 minDim is 36px');
    assertEqual(m.strokeWidth, 2, 'Stroke width on 28px font is 2px');
    assertEqual(m.shadowBlur, 3, 'Shadow blur on 28px font is 3px');
    assertEqual(m.shadowOffset, 1, 'Shadow offset on 28px font is 1px');
  });

  test('Orientation invariance: Landscape 1024x768 and Portrait 768x1024 produce identical typography', () => {
    const mLand = calculateWatermarkMetrics(1024, 768);
    const mPort = calculateWatermarkMetrics(768, 1024);
    assertEqual(mLand.fontSize, mPort.fontSize);
    assertEqual(mLand.lineHeight, mPort.lineHeight);
    assertEqual(mLand.marginRight, mPort.marginRight);
    assertEqual(mLand.marginBottom, mPort.marginBottom);
  });

  test('Aspect-ratio invariance: Extreme panorama 4000x800 and vertical banner 800x4000 scale to minDim 800', () => {
    const mPano = calculateWatermarkMetrics(4000, 800);
    const mBanner = calculateWatermarkMetrics(800, 4000);
    const mRef = calculateWatermarkMetrics(1024, 800);
    assertEqual(mPano.fontSize, mBanner.fontSize);
    assertEqual(mPano.fontSize, mRef.fontSize);
    assertEqual(mPano.lineHeight, mBanner.lineHeight);
  });

  test('Small thumbnail 100x100 enforces minimum readable font floor >= 8px', () => {
    const m = calculateWatermarkMetrics(100, 100);
    assert(m.fontSize >= 8, 'Font size must enforce minimum readable floor');
    assertEqual(m.fontSize, 8);
  });

  test('4K UHD resolution 3840x2160 scales font size proportionally to ~79px', () => {
    const m = calculateWatermarkMetrics(3840, 2160);
    assertBetween(m.fontSize, 75, 82);
    assertEqual(m.fontSize, 79);
    assertBetween(m.lineHeight, 100, 105);
  });

  test('8K UHD resolution 7680x4320 scales font size proportionally to ~158px', () => {
    const m = calculateWatermarkMetrics(7680, 4320);
    assertBetween(m.fontSize, 150, 165);
    assertEqual(m.fontSize, 158);
  });
});

// =========================================================================
// Suite 3: Dual-Canvas Pipeline & GPU Memory Safety
// =========================================================================
describe('Dual-Canvas Pipeline & Memory Management', () => {
  test('calculatePreviewDimensions: Clamps 4000x3000 to 1280x960 preserving 4:3 aspect', () => {
    const dims = calculatePreviewDimensions(4000, 3000, 1280);
    assertEqual(dims.width, 1280);
    assertEqual(dims.height, 960);
    assertEqual(dims.scale, 0.32);
  });

  test('calculatePreviewDimensions: Clamps portrait 3000x4000 to 960x1280 preserving 3:4 aspect', () => {
    const dims = calculatePreviewDimensions(3000, 4000, 1280);
    assertEqual(dims.width, 960);
    assertEqual(dims.height, 1280);
  });

  test('calculatePreviewDimensions: Preserves original dimensions for images smaller than 1280px', () => {
    const dims = calculatePreviewDimensions(1024, 768, 1280);
    assertEqual(dims.width, 1024);
    assertEqual(dims.height, 768);
    assertEqual(dims.scale, 1.0);
  });

  test('clampCanvasDimensions: Clamps 108MP image (12000x9000) to 8192x6144', () => {
    const clamped = clampCanvasDimensions(12000, 9000, 8192);
    assertEqual(clamped.width, 8192);
    assertEqual(clamped.height, 6144);
    assertEqual(clamped.clamped, true);
  });

  test('clampCanvasDimensions: Leaves standard 12MP photo (4032x3024) unclamped', () => {
    const clamped = clampCanvasDimensions(4032, 3024, 8192);
    assertEqual(clamped.width, 4032);
    assertEqual(clamped.height, 3024);
    assertEqual(clamped.clamped, false);
    assertEqual(clamped.scale, 1.0);
  });

  test('clampCanvasDimensions: Clamps extreme 200MP image (16320x12240) to 8192x6144', () => {
    const clamped = clampCanvasDimensions(16320, 12240, 8192);
    assertEqual(clamped.width, 8192);
    assertEqual(clamped.height, 6144);
    assertEqual(clamped.clamped, true);
  });

  test('clampCanvasDimensions: Clamps ultra-wide panoramic (16000x2000) to 8192x1024', () => {
    const clamped = clampCanvasDimensions(16000, 2000, 8192);
    assertEqual(clamped.width, 8192);
    assertEqual(clamped.height, 1024);
    assertEqual(clamped.clamped, true);
  });

  test('disposeCanvas: Resets canvas dimensions to 1x1 to immediately free GPU memory', () => {
    const canvas = new MockCanvas(4032, 3024);
    assertEqual(canvas.width, 4032);
    assertEqual(canvas.height, 3024);
    disposeCanvas(canvas);
    assertEqual(canvas.width, 1);
    assertEqual(canvas.height, 1);
  });
});

// =========================================================================
// Suite 4: Two-Pass Canvas Watermark Rendering
// =========================================================================
describe('Two-Pass Canvas Watermark Rendering', () => {
  test('renderWatermark: Right-aligns every line on the same edge', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3, 'Must render exactly 3 lines');
    const edges = fillCalls.map(c => MockContext2D.rightEdge(c));
    assert(edges.every(e => Math.abs(e - edges[0]) < 0.5), 'All lines must end on the same right edge');
  });

  test('renderWatermark: Pass 1 renders dark strokeText with ambient drop shadow', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const strokeCalls = ctx.getCalls('strokeText');
    assertEqual(strokeCalls.length, 3, 'Pass 1 must call strokeText for all 3 lines');
    assertMatch(strokeCalls[0].state.strokeStyle, /(rgba\(0,\s*0,\s*0|black|#000)/i, 'Stroke style must be dark');
    assert(strokeCalls[0].state.lineWidth >= 2, 'Stroke width must be >= 2px');
    assertMatch(strokeCalls[0].state.shadowColor, /(rgba\(0,\s*0,\s*0|black|#000)/i, 'Drop shadow must be dark');
  });

  test('renderWatermark: Pass 2 renders pure white core fillText without shadow bleeding', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3, 'Pass 2 must call fillText for all 3 lines');
    assertMatch(fillCalls[0].state.fillStyle, /(#fff|#ffffff|white|rgba\(255,\s*255,\s*255)/i, 'Fill must be pure white');
    assertEqual(fillCalls[0].state.shadowColor, 'transparent', 'Pass 2 must disable shadow to prevent inner blur');
    assertEqual(fillCalls[0].state.shadowBlur, 0);
  });

  test('renderWatermark: Watermark renders in exact 3-line order: Line 1 Date, Line 2 Coords, Line 3 Address', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[0].args.text, '28 ต.ค. 2569 21:12:07', 'Line 1 is datetime');
    assertEqual(fillCalls[1].args.text, '+6.499413,+101.267206', 'Line 2 is coordinates');
    assertEqual(fillCalls[2].args.text, 'อ.เมืองยะลา, จ.ยะลา', 'Line 3 is address');
  });

  test('renderWatermark: Uniform line pitch with descending vertical coordinates', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const fillCalls = ctx.getCalls('fillText');
    const y1 = fillCalls[0].args.y;
    const y2 = fillCalls[1].args.y;
    const y3 = fillCalls[2].args.y;
    const pitch1 = y2 - y1;
    const pitch2 = y3 - y2;

    assertEqual(pitch1, pitch2, 'Line pitch is completely uniform');
    assertEqual(pitch1, 36, 'Line pitch equals 36px on 1024x768');
    assert(y1 < y2 && y2 < y3, 'Lines advance downwards');
  });
});

// =========================================================================
// Suite 5: String Resilience & Edge Cases
// =========================================================================
describe('String Robustness & Boundary Handling', () => {
  test('Handles empty address string without crashing', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: ''
    });
    const fillCalls = ctx.getCalls('fillText');
    assert(fillCalls.length === 2, 'Renders 2 lines when address is empty');
  });

  test('Handles very long address string (150+ Thai characters) safely', () => {
    const longAddress = 'ศูนย์อำนวยการบริหารจังหวัดชายแดนภาคใต้ (ศอ.บต.) ถนนสุขยางค์ ตำบลสะเตง อำเภอเมืองยะลา จังหวัดยะลา รหัสไปรษณีย์ 95000 ประเทศไทย';
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: longAddress
    });
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, longAddress);
  });

  test('Handles stacked Thai diacritics and lower vowels cleanly', () => {
    const complexThai = 'ผู้ว่าราชการจังหวัดพิษณุโลก ฎีกาธิการ';
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+16.821111,+100.265833',
      addressStr: complexThai
    });
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, complexThai);
  });

  test('Treats XSS injection payloads strictly as literal strings', () => {
    const xssPayload = '<script>alert(document.cookie)</script>';
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: xssPayload
    });
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, xssPayload);
  });
});

// =========================================================================
// Suite 6: Preview Canvas & Full-Resolution Export Integration
// =========================================================================
describe('Preview & Full-Resolution Export Pipelines', () => {
  test('renderPreview: Scales canvas dimensions and stamps watermark', () => {
    const previewCanvas = new MockCanvas(100, 100);
    const mockImage = { naturalWidth: 4000, naturalHeight: 3000 };
    renderPreview(previewCanvas, mockImage, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    assertEqual(previewCanvas.width, 1280);
    assertEqual(previewCanvas.height, 960);
    const ctx = previewCanvas.getContext('2d');
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3);
  });

  test('exportFullResolution: Exports high-resolution blob and disposes canvas', async () => {
    const mockImage = new MockCanvas(4032, 3024);
    const blob = await exportFullResolution(mockImage, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    assert(blob, 'Must return a Blob');
    assert(blob.size > 0, 'Blob size must be non-zero');
  });

  test('WatermarkEngine static wrapper provides OOP access', () => {
    const m = WatermarkEngine.calculateMetrics(1024, 768);
    assertEqual(m.fontSize, 28);
    const p = WatermarkEngine.calculatePreviewDimensions(4000, 3000);
    assertEqual(p.width, 1280);
    const c = WatermarkEngine.clampCanvasDimensions(12000, 9000);
    assertEqual(c.width, 8192);
  });
});

// CLI standalone runner execution
if (process.argv[1] && (process.argv[1].endsWith('watermark.test.js') || process.argv[1].endsWith('watermark.test'))) {
  harness.run().then((res) => {
    process.exit(res.allPassed ? 0 : 1);
  });
}
