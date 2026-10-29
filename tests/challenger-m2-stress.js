/**
 * tests/challenger-m2-stress.js
 * 
 * EMPIRICAL ADVERSARIAL STRESS HARNESS — MILESTONE M2-CANVAS
 * Challenger: challenger_m2_2
 * 
 * Rigorously stress-tests:
 * 1. Dual-Canvas memory lifecycle & repeated preview rendering churn (100 rapid calls)
 * 2. Repeated export calls, GPU deallocation (`disposeCanvas`), and error-path disposal
 * 3. `calculatePreviewDimensions` across 1,000 randomized dimension pairs + extreme aspect ratios
 * 4. Font timeout resilience & rejection handling in `js/font-loader.js`
 * 5. EXIF orientation matrices 1-8 in combination with `drawOrientedImage`
 */

import { MockCanvas, MockContext2D } from './test-utils.js';

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

import {
  WATERMARK_FONT_FAMILY,
  WATERMARK_FONT_FALLBACK_STACK,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_FONT_SIZE,
  DEFAULT_TIMEOUT_MS,
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
  getOrientationTransform,
  applyCanvasTransform
} from '../js/exif-parser.js';

// Summary tracker
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  failures: [],
  findings: []
};

function assert(condition, testName, details = '') {
  results.total++;
  if (condition) {
    results.passed++;
    console.log(`  [PASS] ${testName}`);
  } else {
    results.failed++;
    const msg = details ? `${testName} -> ${details}` : testName;
    results.failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

function assertEqual(actual, expected, testName) {
  results.total++;
  if (actual === expected) {
    results.passed++;
    console.log(`  [PASS] ${testName}`);
  } else {
    results.failed++;
    const msg = `${testName} -> Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    results.failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

// Polyfill MockContext2D transform methods for orientation tests
if (!MockContext2D.prototype.scale) {
  MockContext2D.prototype.scale = function(x, y) { this.calls.push({ method: 'scale', args: { x, y } }); };
}
if (!MockContext2D.prototype.translate) {
  MockContext2D.prototype.translate = function(x, y) { this.calls.push({ method: 'translate', args: { x, y } }); };
}
if (!MockContext2D.prototype.rotate) {
  MockContext2D.prototype.rotate = function(angle) { this.calls.push({ method: 'rotate', args: { angle } }); };
}



// =========================================================================
// SECTION 1: Repeated Canvas Preview Renders (Churn & Memory Stress)
// =========================================================================
console.log('\n--- SECTION 1: Repeated Canvas Preview Renders (Churn & Memory Stress) ---');

// Test 1.1: 100 rapid sequential preview renders imitating map pin drag
{
  const previewCanvas = new MockCanvas(100, 100);
  const mockImage = { naturalWidth: 4032, naturalHeight: 3024 };
  
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;
  
  let renderErrors = 0;
  for (let i = 0; i < 100; i++) {
    try {
      renderPreview(previewCanvas, mockImage, {
        dateTimeStr: `28 ต.ค. 2569 21:12:${String(i % 60).padStart(2, '0')}`,
        coordsStr: `+${(6.499 + i * 0.0001).toFixed(6)},+101.267206`,
        addressStr: `อ.เมืองยะลา, จ.ยะลา (${i})`
      });
    } catch (err) {
      renderErrors++;
    }
  }

  const memAfter = process.memoryUsage().heapUsed;
  const memDeltaMB = (memAfter - memBefore) / (1024 * 1024);

  assertEqual(renderErrors, 0, '1.1.1: 100 rapid sequential preview renders execute without throwing');
  assertEqual(previewCanvas.width, 1280, '1.1.2: Canvas width correctly clamped to 1280px');
  assertEqual(previewCanvas.height, 960, '1.1.3: Canvas height correctly clamped to 960px');
  
  // Verify context save/restore state balance
  const ctx = previewCanvas.getContext('2d');
  const saveCalls = ctx.getCalls('save').length;
  const restoreCalls = ctx.getCalls('restore').length;
  assertEqual(saveCalls, restoreCalls, '1.1.4: Context save and restore calls are perfectly balanced');
  assert(memDeltaMB < 5.0, '1.1.5: Memory growth across 100 preview renders is bounded (< 5MB delta)', `Delta: ${memDeltaMB.toFixed(2)}MB`);
}

// Test 1.2: 500 rapid renders with alternating resolutions and orientations
{
  const previewCanvas = new MockCanvas(100, 100);
  const resolutions = [
    { w: 4032, h: 3024, ori: 1 },
    { w: 3024, h: 4032, ori: 6 },
    { w: 12000, h: 9000, ori: 1 },
    { w: 800, h: 600, ori: 3 },
    { w: 1920, h: 1080, ori: 8 }
  ];

  let multiErrors = 0;
  for (let i = 0; i < 500; i++) {
    const res = resolutions[i % resolutions.length];
    const mockImg = { naturalWidth: res.w, naturalHeight: res.h };
    try {
      renderPreview(previewCanvas, mockImg, {
        dateTimeStr: '28 ต.ค. 2569 21:12:07',
        coordsStr: '+6.499413,+101.267206',
        addressStr: 'อ.เมืองยะลา, จ.ยะลา'
      }, { orientation: res.ori });
    } catch {
      multiErrors++;
    }
  }

  assertEqual(multiErrors, 0, '1.2.1: 500 rapid preview renders across variable dimensions/orientations succeed');
  assert(previewCanvas.width <= 1280 && previewCanvas.height <= 1280, '1.2.2: Preview dimensions always <= 1280px');
}

// =========================================================================
// SECTION 2: Repeated Export Calls & Canvas Memory Disposal (`disposeCanvas`)
// =========================================================================
console.log('\n--- SECTION 2: Repeated Export Calls & Canvas Memory Disposal ---');

// Test 2.1: 50 sequential exportFullResolution calls verify disposal of each offscreen canvas
{
  const createdCanvases = [];
  const customCanvasFactory = (w, h) => {
    const c = new MockCanvas(w, h);
    createdCanvases.push(c);
    return c;
  };

  const mockImage = new MockCanvas(4032, 3024);
  let exportErrors = 0;

  for (let i = 0; i < 50; i++) {
    try {
      await exportFullResolution(mockImage, {
        dateTimeStr: '28 ต.ค. 2569 21:12:07',
        coordsStr: '+6.499413,+101.267206',
        addressStr: 'อ.เมืองยะลา, จ.ยะลา'
      }, { canvasFactory: customCanvasFactory });
    } catch (err) {
      exportErrors++;
    }
  }

  assertEqual(exportErrors, 0, '2.1.1: 50 sequential exportFullResolution calls complete successfully');
  assertEqual(createdCanvases.length, 50, '2.1.2: Exactly 50 offscreen canvases were instantiated');

  // Verify that all 50 canvases were disposed (dimensions reset to 1x1)
  const allDisposed = createdCanvases.every(c => c.width === 1 && c.height === 1);
  assert(allDisposed, '2.1.3: All 50 offscreen canvases had width=1 and height=1 reset via disposeCanvas');
}

// Test 2.2: Error path resilience in exportFullResolution — Check if canvas is disposed on export failure
{
  let failedCanvas = null;
  const failingCanvasFactory = (w, h) => {
    const c = new MockCanvas(w, h);
    // Override toBlob to simulate an asynchronous export error (e.g. out-of-memory or canvas security error)
    c.toBlob = (callback) => {
      setTimeout(() => callback(null), 10);
    };
    failedCanvas = c;
    return c;
  };

  const mockImage = new MockCanvas(4032, 3024);
  let threwAsExpected = false;
  try {
    await exportFullResolution(mockImage, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: 'อ.เมืองยะลา, จ.ยะลา'
    }, { canvasFactory: failingCanvasFactory });
  } catch (err) {
    threwAsExpected = true;
  }

  assert(threwAsExpected, '2.2.1: exportFullResolution throws error when toBlob fails');
  
  // Adversarial check: did it call disposeCanvas when toBlob threw?
  const disposedOnError = failedCanvas && failedCanvas.width === 1 && failedCanvas.height === 1;
  if (!disposedOnError) {
    results.findings.push({
      id: 'FINDING-1-EXPORT-DISPOSAL-LEAK-ON-ERROR',
      severity: 'MEDIUM',
      title: 'Canvas GPU backing buffer is leaked if exportFullResolution fails during toBlob conversion',
      detail: `When toBlob fails/rejects, exportFullResolution throws before reaching disposeCanvas(exportCanvas). exportCanvas retains full dimensions (${failedCanvas ? failedCanvas.width : 'N/A'}x${failedCanvas ? failedCanvas.height : 'N/A'}) in memory instead of being disposed to 1x1.`
    });
  }
  assert(disposedOnError, '2.2.2: Canvas backing buffer is disposed even when export fails (try...finally guard)', `Canvas remained at ${failedCanvas ? failedCanvas.width : '?' }x${failedCanvas ? failedCanvas.height : '?'}`);
}

// Test 2.3: disposeCanvas edge cases (null, undefined, primitives, objects without getContext)
{
  let disposeThrows = false;
  try {
    disposeCanvas(null);
    disposeCanvas(undefined);
    disposeCanvas(123);
    disposeCanvas('not-a-canvas');
    disposeCanvas({});
    disposeCanvas({ width: 100, height: 100 });
    disposeCanvas(Object.freeze({ width: 100, height: 100 }));
  } catch {
    disposeThrows = true;
  }
  assert(!disposeThrows, '2.3.1: disposeCanvas handles null, primitives, and frozen objects without throwing');
}

// =========================================================================
// SECTION 3: Preview Dimensions Clamping across 1,000 Randomized Dimension Pairs
// =========================================================================
console.log('\n--- SECTION 3: calculatePreviewDimensions 1,000 Randomized Dimension Pairs ---');

{
  let clampingViolations = 0;
  let aspectRoundingViolations = 0;
  let zeroDimensionViolations = 0;

  for (let i = 0; i < 1000; i++) {
    // Generate random dimensions between 1 and 20,000
    const w = Math.floor(Math.random() * 20000) + 1;
    const h = Math.floor(Math.random() * 20000) + 1;

    const res = calculatePreviewDimensions(w, h, 1280);

    // 1. Must never exceed 1280
    if (res.width > 1280 || res.height > 1280) {
      clampingViolations++;
    }

    // 2. Must never round down to 0
    if (res.width < 1 || res.height < 1) {
      zeroDimensionViolations++;
    }

    // 3. Aspect ratio tolerance: width and height should match round(w * scale)
    const maxEdge = Math.max(w, h);
    const expectedScale = maxEdge > 1280 ? 1280 / maxEdge : 1.0;
    const expectedW = Math.round(w * expectedScale);
    const expectedH = Math.round(h * expectedScale);

    if (Math.abs(res.width - expectedW) > 1 || Math.abs(res.height - expectedH) > 1) {
      aspectRoundingViolations++;
    }
  }

  assertEqual(clampingViolations, 0, '3.1.1: Across 1,000 randomized pairs, width and height NEVER exceed 1280px');
  assertEqual(aspectRoundingViolations, 0, '3.1.2: Across 1,000 randomized pairs, dimensions match scaled aspect ratio within ±1px rounding');
  assertEqual(zeroDimensionViolations, 0, '3.1.3: Across 1,000 randomized pairs, dimensions never drop below 1px');
}

// Test 3.2: Extreme aspect ratio tests (Panoramas & Vertical Ribbons)
{
  // Test case: 5000x1 (extreme panorama)
  const panoDims = calculatePreviewDimensions(5000, 1, 1280);
  // Test case: 1x5000 (extreme vertical ribbon)
  const vertDims = calculatePreviewDimensions(1, 5000, 1280);

  const hasZeroPano = panoDims.height === 0;
  const hasZeroVert = vertDims.width === 0;

  if (hasZeroPano || hasZeroVert) {
    results.findings.push({
      id: 'FINDING-2-PREVIEW-ZERO-DIMENSION',
      severity: 'HIGH',
      title: 'calculatePreviewDimensions produces 0px height or width for extreme aspect ratio images',
      detail: `calculatePreviewDimensions(5000, 1) returned width=${panoDims.width}, height=${panoDims.height}. In HTML5 Canvas, setting canvas.height=0 or canvas.width=0 renders the canvas inoperable. Math.max(1, Math.round(...)) floor is missing.`
    });
  }

  assert(!hasZeroPano, '3.2.1: Extreme panorama 5000x1 enforces minimum 1px height (does not round to 0)', `Returned height: ${panoDims.height}`);
  assert(!hasZeroVert, '3.2.2: Extreme vertical ribbon 1x5000 enforces minimum 1px width (does not round to 0)', `Returned width: ${vertDims.width}`);
}

// Test 3.3: Robustness against non-numeric and boundary inputs
{
  const nanRes = calculatePreviewDimensions(NaN, NaN);
  assert(nanRes.width >= 1 && nanRes.height >= 1, '3.3.1: calculatePreviewDimensions handles NaN gracefully');

  const strRes = calculatePreviewDimensions('4000', '3000');
  assertEqual(strRes.width, 1280, '3.3.2: String numeric inputs parsed properly');

  const negRes = calculatePreviewDimensions(-100, -200);
  assert(negRes.width >= 1 && negRes.height >= 1, '3.3.3: Negative inputs clamped to >= 1');
}

// =========================================================================
// SECTION 4: Font Timeout Resilience & Rejection Handling
// =========================================================================
console.log('\n--- SECTION 4: Font Timeout Resilience & Rejection Handling ---');

// Test 4.1: Slow document.fonts.load exceeding timeout
{
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

    assertEqual(result, false, '4.1.1: Slow font load times out and resolves false without hanging');
    assert(elapsed >= 40, '4.1.2: Timeout waited at least requested timeout period', `Elapsed: ${elapsed}ms`);
  } finally {
    if (originalDoc !== undefined) globalThis.document = originalDoc;
    else delete globalThis.document;
  }
}

// Test 4.2: Rejected document.fonts.load (Simulated network failure)
{
  resetFontCache();
  const originalDoc = globalThis.document;
  let unhandledRejection = false;
  const onUnhandled = () => { unhandledRejection = true; };
  process.on('unhandledRejection', onUnhandled);

  try {
    globalThis.document = {
      fonts: {
        check: () => false,
        load: () => Promise.reject(new Error('Simulated HTTP 503 Service Unavailable')),
        ready: Promise.resolve()
      }
    };

    const result = await loadWatermarkFonts({ timeoutMs: 100 });
    assertEqual(result, false, '4.2.1: Rejected document.fonts.load resolves false cleanly');
    assert(!unhandledRejection, '4.2.2: No unhandled promise rejection occurred during network error');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    if (originalDoc !== undefined) globalThis.document = originalDoc;
    else delete globalThis.document;
  }
}

// Test 4.3: Slow document.fonts.load that resolves AFTER timeout expires
{
  resetFontCache();
  const originalDoc = globalThis.document;
  let lateResolver;
  let unhandledRejection = false;
  const onUnhandled = () => { unhandledRejection = true; };
  process.on('unhandledRejection', onUnhandled);

  try {
    globalThis.document = {
      fonts: {
        check: () => false,
        load: () => new Promise((resolve) => { lateResolver = resolve; }),
        ready: Promise.resolve()
      }
    };

    const result = await loadWatermarkFonts({ timeoutMs: 30 });
    assertEqual(result, false, '4.3.1: Times out after 30ms and resolves false');

    // Resolve after timeout
    if (lateResolver) lateResolver(['Sarabun']);
    // Wait for event loop tick
    await new Promise(r => setTimeout(r, 50));

    assert(!unhandledRejection, '4.3.2: Late resolution after timeout does not cause unhandled rejection or crash');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    if (originalDoc !== undefined) globalThis.document = originalDoc;
    else delete globalThis.document;
  }
}

// Test 4.4: document.fonts.check throws unexpected exception
{
  resetFontCache();
  const originalDoc = globalThis.document;
  try {
    globalThis.document = {
      fonts: {
        check: () => { throw new Error('DOM Security / Font Check Internal Error'); }
      }
    };

    const loaded = isFontLoaded('Sarabun', 500, 28);
    assertEqual(loaded, false, '4.4.1: isFontLoaded catches internal check error and returns false');
  } finally {
    if (originalDoc !== undefined) globalThis.document = originalDoc;
    else delete globalThis.document;
  }
}

// Test 4.5: 20 rapid concurrent calls to loadWatermarkFonts() during in-flight load
{
  resetFontCache();
  const originalDoc = globalThis.document;
  let loadCallCount = 0;

  try {
    globalThis.document = {
      fonts: {
        check: () => true,
        load: (spec) => {
          loadCallCount++;
          return new Promise(r => setTimeout(() => r([spec]), 20));
        },
        ready: Promise.resolve()
      }
    };

    const promises = Array.from({ length: 20 }, () => loadWatermarkFonts());
    const allResults = await Promise.all(promises);

    const allTrue = allResults.every(r => r === true);
    assertEqual(allTrue, true, '4.5.1: All 20 concurrent loadWatermarkFonts calls resolve true');
    // weights=[400, 500] = 2 load calls for the single shared promise
    assertEqual(loadCallCount, 2, '4.5.2: In-flight calls de-duplicated to exactly 1 batch (2 weight calls)');
  } finally {
    if (originalDoc !== undefined) globalThis.document = originalDoc;
    else delete globalThis.document;
  }
}

// =========================================================================
// SECTION 5: EXIF Orientation Matrices (Tags 1-8) in drawOrientedImage
// =========================================================================
console.log('\n--- SECTION 5: EXIF Orientation Matrices (Tags 1-8) in drawOrientedImage ---');

// Helper to simulate affine transformation matrix
function simulateTransformMatrix(transformFn) {
  let m = [1, 0, 0, 1, 0, 0];
  function multiply(a2, b2, c2, d2, e2, f2) {
    const [a1, b1, c1, d1, e1, f1] = m;
    m = [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1
    ];
  }
  const fakeCtx = {
    translate(x, y) { multiply(1, 0, 0, 1, x, y); },
    scale(sx, sy) { multiply(sx, 0, 0, sy, 0, 0); },
    rotate(rad) {
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      multiply(cos, sin, -sin, cos, 0, 0);
    }
  };
  transformFn(fakeCtx);
  return m;
}

function getTransformedBoundingBox(matrix, width, height) {
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height]
  ];
  const transformed = corners.map(([x, y]) => [
    Math.round(matrix[0] * x + matrix[2] * y + matrix[4]),
    Math.round(matrix[1] * x + matrix[3] * y + matrix[5])
  ]);
  const xs = transformed.map(p => p[0]);
  const ys = transformed.map(p => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    corners: transformed
  };
}

const W = 4000;
const H = 3000;

for (let ori = 1; ori <= 8; ori++) {
  const info = getOrientationTransform(ori, W, H);
  const matrix = simulateTransformMatrix(ctx => {
    applyCanvasTransform(ctx, ori, W, H);
  });
  const bbox = getTransformedBoundingBox(matrix, W, H);

  const matchesExpectedBounds =
    bbox.minX === 0 &&
    bbox.minY === 0 &&
    bbox.maxX === info.width &&
    bbox.maxY === info.height;

  if (!matchesExpectedBounds) {
    results.findings.push({
      id: `FINDING-3-EXIF-ORIENTATION-${ori}-OUT-OF-BOUNDS`,
      severity: 'HIGH',
      title: `applyCanvasTransform for EXIF Orientation ${ori} draws completely outside canvas viewport`,
      detail: `EXIF Orientation ${ori}: Expected canvas bounding box [0, 0] to [${info.width}, ${info.height}], but actual transformed bounding box is [${bbox.minX}, ${bbox.minY}] to [${bbox.maxX}, ${bbox.maxY}]. Image is rendered outside canvas viewable area.`
    });
  }

  assert(
    matchesExpectedBounds,
    `5.1.${ori}: EXIF Orientation ${ori} bounds [${bbox.minX}, ${bbox.minY}] to [${bbox.maxX}, ${bbox.maxY}] match expected [0, 0] to [${info.width}, ${info.height}]`,
    `Actual: [${bbox.minX}, ${bbox.minY}] to [${bbox.maxX}, ${bbox.maxY}] vs Expected: [0, 0] to [${info.width}, ${info.height}]`
  );
}

// Test 5.2: drawOrientedImage with MockCanvas across all 8 orientations
{
  let drawOrientedErrors = 0;
  for (let ori = 1; ori <= 8; ori++) {
    const canvas = new MockCanvas(960, 1280);
    const ctx = canvas.getContext('2d');
    const mockImg = { naturalWidth: 4000, naturalHeight: 3000 };
    try {
      drawOrientedImage(ctx, mockImg, 960, 1280, ori);
      const drawCalls = ctx.getCalls('drawImage');
      if (drawCalls.length !== 1) {
        drawOrientedErrors++;
      }
    } catch {
      drawOrientedErrors++;
    }
  }
  assertEqual(drawOrientedErrors, 0, '5.2.1: drawOrientedImage executes drawImage call across all 8 orientations without throwing');
}

// =========================================================================
// FINAL VERDICT & REPORTING
// =========================================================================
console.log('\n===========================================================');
console.log('             M2-CANVAS ADVERSARIAL STRESS REPORT           ');
console.log('===========================================================');
console.log(`Total Assertions Checked: ${results.total}`);
console.log(`Passed:                   ${results.passed}`);
console.log(`Failed:                   ${results.failed}`);
console.log(`Findings Discovered:      ${results.findings.length}`);

if (results.findings.length > 0) {
  console.log('\n--- Empirical Vulnerabilities & Defects Discovered ---');
  results.findings.forEach((f, idx) => {
    console.log(`\n[${idx + 1}] [${f.severity}] ${f.id}: ${f.title}`);
    console.log(`    Detail: ${f.detail}`);
  });
}

console.log('\n-----------------------------------------------------------');
if (results.failed === 0) {
  console.log('>>> VERDICT: APPROVE <<<');
} else {
  console.log('>>> VERDICT: REQUEST_CHANGES <<<');
}
console.log('===========================================================\n');

process.exit(results.failed === 0 ? 0 : 1);
