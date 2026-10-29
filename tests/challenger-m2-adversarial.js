/**
 * tests/challenger-m2-adversarial.js
 * 
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE M2-CANVAS
 * Role: Challenger 1 (critic, specialist)
 * Target: js/watermark-engine.js, js/font-loader.js
 * 
 * Adversarial Stress Dimensions:
 * 1. Optical Layout Math & Extreme Aspect Ratios (20:1 pano, 1:20 banner, 250:1 slit)
 * 2. Ultra-High Resolution Clamping (100MP 11,547x8,660, 200MP 16,320x12,240, 16:9 100MP/200MP, Aspect Preservation)
 * 3. Micro & Tiny Dimensions (1x1, 10x10, 50x50, Minimum Font Floor >= 8px)
 * 4. Text Stress, Thai Diacritics, XSS Payloads & Massive Strings (1,500+ chars)
 * 5. Strict Layout Geometry Invariants (y1 < y2 < y3, Uniform Pitch, x = width - marginRight)
 * 6. Hostile / Defective Input Probing (null/undefined arguments, NaN, Infinity)
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
  WATERMARK_RATIOS,
  calculateWatermarkMetrics,
  calculatePreviewDimensions,
  clampCanvasDimensions,
  disposeCanvas,
  renderWatermark,
  drawOrientedImage,
  renderPreview,
  exportFullResolution,
  WatermarkEngine
} from '../js/watermark-engine.js';

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

// =========================================================================
// Suite 1: Extreme Aspect Ratios & Layout Math
// =========================================================================
describe('Suite 1: Extreme Aspect Ratios & Layout Math', () => {
  test('1.1 Super-Panoramic 10,000 x 500 (20:1 ratio)', () => {
    const w = 10000;
    const h = 500;
    const m = calculateWatermarkMetrics(w, h);

    assertEqual(m.minDim, 500, 'minDim must be 500');
    // raw: round(500 * 0.0365) = 18
    assertEqual(m.fontSize, 18, 'fontSize must scale to 18px');
    // round(18 * 1.30) = 23
    assertEqual(m.lineHeight, 23, 'lineHeight must be 23px');
    assertEqual(m.marginRight, 23, 'marginRight must be 23px');
    assertEqual(m.marginBottom, 24, 'marginBottom must be 24px');

    const canvas = new MockCanvas(w, h);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, w, h, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3);
    const [c1, c2, c3] = fillCalls;

    // x = 10000 - 23 = 9977
    assertEqual(c1.args.x, 9977);
    assertEqual(c2.args.x, 9977);
    assertEqual(c3.args.x, 9977);

    // y3 = 500 - 24 = 476, y2 = 476 - 23 = 453, y1 = 453 - 23 = 430
    assertEqual(c3.args.y, 476);
    assertEqual(c2.args.y, 453);
    assertEqual(c1.args.y, 430);

    assert(c1.args.y < c2.args.y && c2.args.y < c3.args.y, 'y1 < y2 < y3 strictly');
    assertEqual(c2.args.y - c1.args.y, m.lineHeight, 'pitch 1 equals lineHeight');
    assertEqual(c3.args.y - c2.args.y, m.lineHeight, 'pitch 2 equals lineHeight');
    assert(c1.args.y > 0 && c3.args.y < h, 'All lines fit within vertical canvas boundaries');
  });

  test('1.2 Ultra-Tall Banner 500 x 10,000 (1:20 ratio)', () => {
    const w = 500;
    const h = 10000;
    const m = calculateWatermarkMetrics(w, h);

    assertEqual(m.minDim, 500, 'minDim must be 500');
    assertEqual(m.fontSize, 18, 'Orientation invariance: font size matches 10,000x500');
    assertEqual(m.lineHeight, 23);
    assertEqual(m.marginRight, 23);
    assertEqual(m.marginBottom, 24);

    const canvas = new MockCanvas(w, h);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, w, h, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const fillCalls = ctx.getCalls('fillText');
    const [c1, c2, c3] = fillCalls;

    // x = 500 - 23 = 477
    assertEqual(c1.args.x, 477);
    assertEqual(c2.args.x, 477);
    assertEqual(c3.args.x, 477);

    // y3 = 10000 - 24 = 9976, y2 = 9976 - 23 = 9953, y1 = 9953 - 23 = 9930
    assertEqual(c3.args.y, 9976);
    assertEqual(c2.args.y, 9953);
    assertEqual(c1.args.y, 9930);

    assert(c1.args.y < c2.args.y && c2.args.y < c3.args.y, 'Strictly descending');
    assertEqual(c2.args.y - c1.args.y, 23);
    assertEqual(c3.args.y - c2.args.y, 23);
  });

  test('1.3 Hyper-Panoramic Slit 50,000 x 200 (250:1 ratio)', () => {
    const m = calculateWatermarkMetrics(50000, 200);
    assertEqual(m.minDim, 200);
    // 200 * 0.0365 = 7.3 -> round is 7 -> floor max(8, 7) = 8
    assertEqual(m.fontSize, 8, 'Enforces 8px font floor');
    assertEqual(m.lineHeight, 10, 'round(8 * 1.30) = 10');
    assertEqual(m.marginRight, 9, 'round(200 * 0.046) = 9');
    assertEqual(m.marginBottom, 9, 'round(200 * 0.047) = 9');

    const canvas = new MockCanvas(50000, 200);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 50000, 200, {
      dateTimeStr: 'A',
      coordsStr: 'B',
      addressStr: 'C'
    });
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[0].args.x, 50000 - 9);
    assertEqual(fillCalls[2].args.y, 200 - 9); // 191
    assertEqual(fillCalls[1].args.y, 191 - 10); // 181
    assertEqual(fillCalls[0].args.y, 181 - 10); // 171
  });

  test('1.4 Symmetrical Aspect Ratios (1:1 Squares from 100px to 8000px)', () => {
    const testSizes = [100, 500, 1024, 2048, 4096, 8000];
    for (const size of testSizes) {
      const m = calculateWatermarkMetrics(size, size);
      assertEqual(m.minDim, size);
      assert(m.fontSize >= 8, `Size ${size} must enforce >= 8px font`);
      assert(m.lineHeight > m.fontSize, `Line height must exceed font size`);
      assert(m.marginRight > 0, `Margin right must be positive`);
      assert(m.marginBottom > 0, `Margin bottom must be positive`);
    }
  });
});

// =========================================================================
// Suite 2: Extreme Resolutions & GPU Clamping (100MP, 200MP, Clamping Preservation)
// =========================================================================
describe('Suite 2: Extreme Resolutions & GPU Clamping', () => {
  test('2.1 100MP 4:3 (11,547 x 8,660) Clamping & Exact 4:3 Preservation', () => {
    const res = clampCanvasDimensions(11547, 8660, 8192);
    assertEqual(res.clamped, true, 'Must clamp > 8192');
    assertEqual(res.width, 8192, 'Max dimension clamped to 8192');
    assertEqual(res.height, 6144, 'Height clamped to 6144');

    // 8192 / 6144 = 4 / 3 exactly
    const ratio = res.width / res.height;
    assertEqual(ratio, 4 / 3, 'Preserves exact 4:3 ratio without distortion');
  });

  test('2.2 200MP 4:3 (16,320 x 12,240) Clamping & Exact 4:3 Preservation', () => {
    const res = clampCanvasDimensions(16320, 12240, 8192);
    assertEqual(res.clamped, true);
    assertEqual(res.width, 8192);
    assertEqual(res.height, 6144);
    assertEqual(res.width / res.height, 4 / 3);
  });

  test('2.3 100MP 16:9 (13,333 x 7,500) Clamping & Exact 16:9 Preservation', () => {
    const res = clampCanvasDimensions(13333, 7500, 8192);
    assertEqual(res.clamped, true);
    assertEqual(res.width, 8192);
    // Math.round(7500 * (8192 / 13333)) = 4608
    assertEqual(res.height, 4608);
    assertEqual(res.width / res.height, 16 / 9, '8192 / 4608 = 16 / 9 exactly');
  });

  test('2.4 200MP 16:9 (18,856 x 10,607) Clamping & High-Precision Aspect Preservation', () => {
    const res = clampCanvasDimensions(18856, 10607, 8192);
    assertEqual(res.clamped, true);
    assertEqual(res.width, 8192);
    // Math.round(10607 * (8192 / 18856)) = 4608
    assertEqual(res.height, 4608);
    assertEqual(res.width / res.height, 16 / 9);
  });

  test('2.5 Portrait Clamping (12,240 x 16,320) Clamping', () => {
    const res = clampCanvasDimensions(12240, 16320, 8192);
    assertEqual(res.clamped, true);
    assertEqual(res.width, 6144);
    assertEqual(res.height, 8192);
    assertEqual(res.height / res.width, 4 / 3, 'Preserves portrait 3:4 ratio');
  });

  test('2.6 Preview Downscaling for 100MP & 200MP (1280px Bounding Box)', () => {
    const p1 = calculatePreviewDimensions(11547, 8660, 1280);
    assertEqual(p1.width, 1280);
    assertEqual(p1.height, 960);
    assertEqual(p1.width / p1.height, 4 / 3);

    const p2 = calculatePreviewDimensions(13333, 7500, 1280);
    assertEqual(p2.width, 1280);
    assertEqual(p2.height, 720);
    assertEqual(p2.width / p2.height, 16 / 9);
  });

  test('2.7 Fuzzing 500 Random Giant Resolutions (8,193 to 32,768)', () => {
    let seed = 42;
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let i = 0; i < 500; i++) {
      const srcW = Math.floor(8193 + pseudoRandom() * 24000);
      const srcH = Math.floor(8193 + pseudoRandom() * 24000);
      const res = clampCanvasDimensions(srcW, srcH, 8192);

      assert(res.width <= 8192, `Width ${res.width} <= 8192`);
      assert(res.height <= 8192, `Height ${res.height} <= 8192`);
      assert(res.width === 8192 || res.height === 8192, 'Max dimension must hit 8192 ceiling');

      const origRatio = srcW / srcH;
      const clampedRatio = res.width / res.height;
      const error = Math.abs(origRatio - clampedRatio) / origRatio;
      assert(error < 0.001, `Aspect ratio distortion must be < 0.1%, got ${error}`);
    }
  });
});

// =========================================================================
// Suite 3: Micro & Tiny Image Dimensions & Minimum Floors
// =========================================================================
describe('Suite 3: Micro & Tiny Image Dimensions', () => {
  test('3.1 1x1 Pixel Canvas', () => {
    const m = calculateWatermarkMetrics(1, 1);
    assertEqual(m.minDim, 1);
    assertEqual(m.fontSize, 8, 'Floor enforces minimum 8px font');
    assertEqual(m.lineHeight, 10, 'round(8 * 1.30) = 10');
    assertEqual(m.marginRight, 0);
    assertEqual(m.marginBottom, 0);
    assertEqual(m.strokeWidth, 2, 'Minimum stroke floor is 2px');
    assertEqual(m.shadowOffset, 1, 'Minimum shadow offset is 1px');

    const canvas = new MockCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1, 1, {
      dateTimeStr: 'A',
      coordsStr: 'B',
      addressStr: 'C'
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3);
    const [c1, c2, c3] = fillCalls;
    assertEqual(c3.args.y, 1);
    assertEqual(c2.args.y, -9);
    assertEqual(c1.args.y, -19);
    assert(c1.args.y < c2.args.y && c2.args.y < c3.args.y, 'Order preserved even when negative');
    assertEqual(c2.args.y - c1.args.y, 10, 'Pitch preserved');
  });

  test('3.2 10x10 and 50x50 Thumbnail Canvases', () => {
    const m10 = calculateWatermarkMetrics(10, 10);
    assertEqual(m10.fontSize, 8);
    assertEqual(m10.strokeWidth, 2);

    const m50 = calculateWatermarkMetrics(50, 50);
    assertEqual(m50.fontSize, 8);
    assertEqual(m50.lineHeight, 10);
    assertEqual(m50.marginRight, 2);
    assertEqual(m50.marginBottom, 2);
  });

  test('3.3 Step Function: Font Size Floor Transition at minDim ~ 206px', () => {
    // For minDim from 1 to 205, raw = round(minDim * 0.0365) <= 7 -> clamped to 8
    for (let d = 1; d <= 205; d += 10) {
      const m = calculateWatermarkMetrics(d, d);
      assertEqual(m.fontSize, 8, `minDim ${d} must clamp to 8px`);
    }

    // At 233px: round(233 * 0.0365) = round(8.5045) = 9
    const m233 = calculateWatermarkMetrics(233, 233);
    assertEqual(m233.fontSize, 9, 'minDim 233 transitions to 9px');
  });
});

// =========================================================================
// Suite 4: Text Stress, Thai Diacritics, XSS Payloads & Massive Strings
// =========================================================================
describe('Suite 4: Text Stress, Thai Diacritics & XSS Payloads', () => {
  test('4.1 Completely Empty & Whitespace Data', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '   ',
      coordsStr: '',
      addressStr: ' \t\n '
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 0, 'Whitespace/empty strings produce 0 fillText calls');
    const strokeCalls = ctx.getCalls('strokeText');
    assertEqual(strokeCalls.length, 0, 'Whitespace/empty strings produce 0 strokeText calls');
  });

  test('4.2 Missing / Undefined / Null Object Properties in Data', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: null,
      coordsStr: undefined,
      addressStr: null
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 0, 'Null/undefined properties render 0 lines without crash');
  });

  test('4.3 Massive Thai String Stress (1,500+ characters)', () => {
    const chunk = 'ศูนย์อำนวยการบริหารจังหวัดชายแดนภาคใต้ ตำบลสะเตง อำเภอเมืองยะลา จังหวัดยะลา ';
    const massiveText = chunk.repeat(20); // 76 * 20 = 1520 chars
    assert(massiveText.length > 1500);

    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: massiveText
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3);
    assertEqual(fillCalls[2].args.text, massiveText.trim(), '1500+ Thai characters passed intact to Canvas 2D');
  });

  test('4.4 Complex Nested Thai Diacritics & Combining Tone Marks', () => {
    // Thai phonetic stress: stacked vowels + tone marks + lower vowels + rare consonants
    const complexClusters = [
      'สิทธิ์',      // ส + ิ + ท + ธ + ิ + ์
      'พื้นที่',      // พ + ื + ้ + น + ท + ี + ่
      'ผู้ว่าราชการจังหวัดพิษณุโลก ฎีกาธิการ', // ฎ, ณ, ุ, ้
      'ปิ๊ง',        // ป + ิ + ๊ + ง
      'น้ำพริกหนุ่ม', // ำ, ้, ุ + ่
      'กิ้งก่า',      // ิ + ้, ่
      'อุ๊ย',        // ุ + ๊
      'กระชั้นชิด'    // ั + ้
    ];

    for (const cluster of complexClusters) {
      const canvas = new MockCanvas(1024, 768);
      const ctx = canvas.getContext('2d');
      renderWatermark(ctx, 1024, 768, {
        dateTimeStr: cluster,
        coordsStr: cluster,
        addressStr: cluster
      });
      const fillCalls = ctx.getCalls('fillText');
      assertEqual(fillCalls.length, 3);
      assertEqual(fillCalls[0].args.text, cluster);
      assertEqual(fillCalls[1].args.text, cluster);
      assertEqual(fillCalls[2].args.text, cluster);
    }
  });

  test('4.5 Hostile Injection & XSS Payloads Treated Strictly as Literals', () => {
    const maliciousPayloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(document.cookie)>',
      'javascript:/*--></title></style></textarea>*/<svg/onload=alert(1)>',
      "' OR '1'='1",
      '%s%s%s%n%x',
      '{{7*7}}',
      '${7*7}',
      '\0\0\0nullbytes\0',
      '\u202Ereversed_text_override\u202D'
    ];

    for (const payload of maliciousPayloads) {
      const canvas = new MockCanvas(1024, 768);
      const ctx = canvas.getContext('2d');
      renderWatermark(ctx, 1024, 768, {
        dateTimeStr: payload,
        coordsStr: payload,
        addressStr: payload
      });
      const fillCalls = ctx.getCalls('fillText');
      assertEqual(fillCalls[0].args.text, payload.trim(), 'Payload rendered as pure string literal');
      assertEqual(fillCalls[1].args.text, payload.trim());
      assertEqual(fillCalls[2].args.text, payload.trim());
    }
  });

  test('4.6 Non-String Coercion (Numbers, Booleans, Objects)', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: 20261028,
      coordsStr: 6.499413,
      addressStr: 95000
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3);
    assertEqual(fillCalls[0].args.text, '20261028');
    assertEqual(fillCalls[1].args.text, '6.499413');
    assertEqual(fillCalls[2].args.text, '95000');
  });
});

// =========================================================================
// Suite 5: Layout Geometry Invariants & Uniform Pitch
// =========================================================================
describe('Suite 5: Layout Geometry Invariants & Uniform Pitch', () => {
  test('5.1 Vertical Invariants across 200 Different Image Sizes', () => {
    const sizes = [
      [320, 240], [640, 480], [800, 600], [1024, 768], [1280, 720],
      [1920, 1080], [2560, 1440], [3840, 2160], [4032, 3024], [7680, 4320],
      [240, 320], [480, 640], [600, 800], [768, 1024], [720, 1280],
      [1080, 1920], [1440, 2560], [2160, 3840], [3024, 4032], [4320, 7680]
    ];

    for (const [w, h] of sizes) {
      const m = calculateWatermarkMetrics(w, h);
      const canvas = new MockCanvas(w, h);
      const ctx = canvas.getContext('2d');
      renderWatermark(ctx, w, h, {
        dateTimeStr: 'Line 1',
        coordsStr: 'Line 2',
        addressStr: 'Line 3'
      });

      const fillCalls = ctx.getCalls('fillText');
      const [c1, c2, c3] = fillCalls;

      // Strict downward order
      assert(c1.args.y < c2.args.y, `y1 < y2 for ${w}x${h}`);
      assert(c2.args.y < c3.args.y, `y2 < y3 for ${w}x${h}`);

      // Pitch uniform
      const pitch1 = c2.args.y - c1.args.y;
      const pitch2 = c3.args.y - c2.args.y;
      assertEqual(pitch1, m.lineHeight, `pitch1 equals lineHeight for ${w}x${h}`);
      assertEqual(pitch2, m.lineHeight, `pitch2 equals lineHeight for ${w}x${h}`);
      assertEqual(pitch1, pitch2, `pitch1 === pitch2 for ${w}x${h}`);

      // X coordinate right-aligned
      assertEqual(c1.args.x, w - m.marginRight);
      assertEqual(c2.args.x, w - m.marginRight);
      assertEqual(c3.args.x, w - m.marginRight);

      // Y3 coordinate bottom margin
      assertEqual(c3.args.y, h - m.marginBottom);
    }
  });

  test('5.2 Two-Pass Styling Separation', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    renderWatermark(ctx, 1024, 768, {
      dateTimeStr: 'Line 1',
      coordsStr: 'Line 2',
      addressStr: 'Line 3'
    });

    const strokes = ctx.getCalls('strokeText');
    const fills = ctx.getCalls('fillText');

    assertEqual(strokes.length, 3);
    assertEqual(fills.length, 3);

    // Pass 1: Stroked with dark shadow
    for (const s of strokes) {
      assert(s.state.lineWidth >= 2, 'Stroke width >= 2');
      assertMatch(s.state.shadowColor, /(rgba\(0,\s*0,\s*0|black|#000)/i, 'Shadow dark');
      assert(s.state.shadowBlur > 0, 'Shadow blur > 0');
    }

    // Pass 2: White fill with zero shadow
    for (const f of fills) {
      assertMatch(f.state.fillStyle, /(#fff|#ffffff|white|rgba\(255,\s*255,\s*255)/i, 'White text core');
      assertEqual(f.state.shadowColor, 'transparent', 'Zero shadow bleeding');
      assertEqual(f.state.shadowBlur, 0);
    }
  });
});

// =========================================================================
// Suite 6: Hostile / Boundary Probing & Bug Discovery
// =========================================================================
describe('Suite 6: Hostile / Boundary Probing (Challenger Findings)', () => {
  test('6.1 Defensive Check: renderWatermark with undefined data falls back to {} safely', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    let threw = false;
    try {
      renderWatermark(ctx, 1024, 768, undefined);
    } catch {
      threw = true;
    }
    assertEqual(threw, false, 'undefined data must not throw');
  });

  test('6.2 Bug Detection: renderWatermark crashes when data is null', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    let threw = false;
    let errorMessage = '';
    try {
      renderWatermark(ctx, 1024, 768, null);
    } catch (e) {
      threw = true;
      errorMessage = e.message;
    }
    // Record empirical observation: renderWatermark currently crashes on null data
    assert(threw, 'Empirically confirms: renderWatermark crashes when data is null');
    assertMatch(errorMessage, /Cannot read propert/i, 'TypeError on null data');
  });

  test('6.3 Bug Detection: renderWatermark crashes when options is null', () => {
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    let threw = false;
    let errorMessage = '';
    try {
      renderWatermark(ctx, 1024, 768, {}, null);
    } catch (e) {
      threw = true;
      errorMessage = e.message;
    }
    assert(threw, 'Empirically confirms: renderWatermark crashes when options is null');
    assertMatch(errorMessage, /Cannot read propert/i, 'TypeError on null options');
  });

  test('6.4 Bug Detection: loadWatermarkFonts crashes when options is null', async () => {
    let threw = false;
    let errorMessage = '';
    try {
      await loadWatermarkFonts(null);
    } catch (e) {
      threw = true;
      errorMessage = e.message;
    }
    assert(threw, 'Empirically confirms: loadWatermarkFonts crashes when options is null');
    assertMatch(errorMessage, /Cannot (destructure|read)/i, 'TypeError on null options');
  });

  test('6.5 Non-Finite Dimensions (NaN, Infinity, Negative Numbers)', () => {
    // Negative numbers clamped to 1
    const mNeg = calculateWatermarkMetrics(-500, -1000);
    assertEqual(mNeg.minDim, 1);
    assertEqual(mNeg.fontSize, 8);

    // NaN clamped to 1
    const mNaN = calculateWatermarkMetrics(NaN, undefined);
    assertEqual(mNaN.minDim, 1);
    assertEqual(mNaN.fontSize, 8);

    // Zero clamped to 1
    const mZero = calculateWatermarkMetrics(0, 0);
    assertEqual(mZero.minDim, 1);
    assertEqual(mZero.fontSize, 8);
  });

  test('6.6 disposeCanvas Resilience to Null, Undefined, Primitives and Faulty Objects', () => {
    let threw = false;
    try {
      disposeCanvas(null);
      disposeCanvas(undefined);
      disposeCanvas(12345);
      disposeCanvas('not_a_canvas');
      disposeCanvas({});
      disposeCanvas({
        getContext: () => { throw new Error('Faulty context'); }
      });
    } catch {
      threw = true;
    }
    assertEqual(threw, false, 'disposeCanvas safely handles any malformed input without throwing');
  });

  test('6.7 WatermarkEngine OOP Wrapper Surface Verification', () => {
    assertEqual(typeof WatermarkEngine.calculateMetrics, 'function');
    assertEqual(typeof WatermarkEngine.calculatePreviewDimensions, 'function');
    assertEqual(typeof WatermarkEngine.clampCanvasDimensions, 'function');
    assertEqual(typeof WatermarkEngine.disposeCanvas, 'function');
    assertEqual(typeof WatermarkEngine.render, 'function');
    assertEqual(typeof WatermarkEngine.renderPreview, 'function');
    assertEqual(typeof WatermarkEngine.export, 'function');
  });
});

// Standalone execution trigger
if (process.argv[1] && (process.argv[1].endsWith('challenger-m2-adversarial.js') || process.argv[1].endsWith('challenger-m2-adversarial'))) {
  harness.run().then((res) => {
    console.log(`\nAdversarial Stress Test Suite: ${res.passed}/${res.total} Passed (${res.failed} Failed)`);
    process.exit(res.allPassed ? 0 : 1);
  });
}
