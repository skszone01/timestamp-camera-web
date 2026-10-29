/**
 * tests/challenger-m2-iter2-deep-probe.js
 * 
 * Challenger M2 Iteration 2 Deep Empirical Verification & Stress Probe
 */

import { MockCanvas, MockContext2D } from './test-utils.js';
import {
  calculatePreviewDimensions,
  clampCanvasDimensions,
  disposeCanvas,
  renderWatermark,
  drawOrientedImage,
  exportFullResolution
} from '../js/watermark-engine.js';
import {
  applyCanvasTransform,
  getOrientationTransform
} from '../js/exif-parser.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(desc, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${desc}`);
  } else {
    failed++;
    const msg = extra ? `${desc}: ${extra}` : desc;
    failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

console.log('=== Challenger M2 Iteration 2 Deep Empirical Probe ===\n');

// 1. Defect 1 Deep Dive: exportFullResolution disposal on ANY failure
console.log('--- 1. Defect 1: Error disposal in exportFullResolution ---');

// Case A: synchronous throw in canvasFactory / getContext
{
  let disposed = false;
  const badCanvas = new MockCanvas(2000, 1000);
  badCanvas.getContext = () => { throw new Error('Context creation failure'); };
  
  let threw = false;
  try {
    await exportFullResolution(new MockCanvas(2000, 1000), {}, {
      canvasFactory: () => badCanvas
    });
  } catch (e) {
    threw = true;
  }
  check('1.A: Throws on getContext error', threw);
  check('1.A: Canvas disposed on getContext error', badCanvas.width === 1 && badCanvas.height === 1);
}

// Case B: async rejection in toBlob
{
  const badCanvas = new MockCanvas(3000, 2000);
  badCanvas.toBlob = (cb) => {
    setTimeout(() => cb(null), 10);
  };
  let threw = false;
  try {
    await exportFullResolution(new MockCanvas(3000, 2000), {}, {
      canvasFactory: () => badCanvas
    });
  } catch (e) {
    threw = true;
  }
  check('1.B: Throws on toBlob null callback', threw);
  check('1.B: Canvas disposed on toBlob null callback', badCanvas.width === 1 && badCanvas.height === 1);
}

// Case C: synchronous throw in toBlob
{
  const badCanvas = new MockCanvas(4000, 3000);
  badCanvas.toBlob = () => { throw new Error('Synchronous toBlob error'); };
  let threw = false;
  try {
    await exportFullResolution(new MockCanvas(4000, 3000), {}, {
      canvasFactory: () => badCanvas
    });
  } catch (e) {
    threw = true;
  }
  check('1.C: Throws on synchronous toBlob error', threw);
  check('1.C: Canvas disposed on synchronous toBlob error', badCanvas.width === 1 && badCanvas.height === 1);
}

// Case D: convertToBlob rejection (OffscreenCanvas)
{
  const badCanvas = new MockCanvas(4000, 3000);
  badCanvas.convertToBlob = () => Promise.reject(new Error('convertToBlob rejected'));
  let threw = false;
  try {
    await exportFullResolution(new MockCanvas(4000, 3000), {}, {
      canvasFactory: () => badCanvas
    });
  } catch (e) {
    threw = true;
  }
  check('1.D: Throws on convertToBlob rejection', threw);
  check('1.D: Canvas disposed on convertToBlob rejection', badCanvas.width === 1 && badCanvas.height === 1);
}

// 2. Defect 2 Deep Dive: calculatePreviewDimensions & clampCanvasDimensions extreme inputs
console.log('\n--- 2. Defect 2: calculatePreviewDimensions & clampCanvasDimensions edge cases ---');

const extremePairs = [
  [5000, 1],
  [1, 5000],
  [100000, 1],
  [1, 100000],
  [0, 0],
  [-100, -200],
  [0.0001, 10000],
  [10000, 0.0001],
  [NaN, NaN],
  [null, undefined]
];

for (const [w, h] of extremePairs) {
  const p = calculatePreviewDimensions(w, h, 1280);
  check(`2.1 calculatePreviewDimensions(${w}, ${h}) width >= 1`, p.width >= 1, `got ${p.width}`);
  check(`2.1 calculatePreviewDimensions(${w}, ${h}) height >= 1`, p.height >= 1, `got ${p.height}`);
  check(`2.1 calculatePreviewDimensions(${w}, ${h}) width <= 1280`, p.width <= 1280, `got ${p.width}`);
  check(`2.1 calculatePreviewDimensions(${w}, ${h}) height <= 1280`, p.height <= 1280, `got ${p.height}`);

  const c = clampCanvasDimensions(w, h, 8192);
  check(`2.2 clampCanvasDimensions(${w}, ${h}) width >= 1`, c.width >= 1, `got ${c.width}`);
  check(`2.2 clampCanvasDimensions(${w}, ${h}) height >= 1`, c.height >= 1, `got ${c.height}`);
  check(`2.2 clampCanvasDimensions(${w}, ${h}) width <= 8192`, c.width <= 8192, `got ${c.width}`);
  check(`2.2 clampCanvasDimensions(${w}, ${h}) height <= 8192`, c.height <= 8192, `got ${c.height}`);
}

// 3. Defect 3 Deep Dive: EXIF orientation transformations 1-8 exhaustive geometric verification
console.log('\n--- 3. Defect 3: EXIF orientation geometric validation ---');

function simulateMatrix(transformFn) {
  let m = [1, 0, 0, 1, 0, 0];
  function mul(a2, b2, c2, d2, e2, f2) {
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
    translate(x, y) { mul(1, 0, 0, 1, x, y); },
    scale(sx, sy) { mul(sx, 0, 0, sy, 0, 0); },
    rotate(rad) {
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      mul(c, s, -s, c, 0, 0);
    }
  };
  transformFn(fakeCtx);
  return m;
}

const W = 4032;
const H = 3024;

for (let ori = 1; ori <= 8; ori++) {
  const transform = getOrientationTransform(ori, W, H);
  const m = simulateMatrix(ctx => applyCanvasTransform(ctx, ori, W, H));
  
  // Transform all 4 corners: (0,0), (W,0), (W,H), (0,H)
  const corners = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H]
  ];
  
  const mapped = corners.map(([x, y]) => [
    Math.round(m[0] * x + m[2] * y + m[4]),
    Math.round(m[1] * x + m[3] * y + m[5])
  ]);
  
  const xs = mapped.map(p => p[0]);
  const ys = mapped.map(p => p[1]);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  check(`3.1 Orientation ${ori} minX === 0`, minX === 0, `got ${minX}`);
  check(`3.1 Orientation ${ori} minY === 0`, minY === 0, `got ${minY}`);
  check(`3.1 Orientation ${ori} maxX === ${transform.width}`, maxX === transform.width, `got ${maxX}`);
  check(`3.1 Orientation ${ori} maxY === ${transform.height}`, maxY === transform.height, `got ${maxY}`);
  
  // Also check that area is preserved (determinant magnitude is 1)
  const det = Math.round(Math.abs(m[0] * m[3] - m[1] * m[2]));
  check(`3.2 Orientation ${ori} determinant magnitude is 1`, det === 1, `got ${det}`);
}

// 4. Defect 4 Deep Dive: renderWatermark null/undefined safety
console.log('\n--- 4. Defect 4: renderWatermark null/undefined argument resilience ---');

{
  const canvas = new MockCanvas(1024, 768);
  const ctx = canvas.getContext('2d');
  
  const nullInputs = [
    [null, null],
    [undefined, undefined],
    [{}, null],
    [null, {}],
    [{ dateTimeStr: null, coordsStr: null, addressStr: null }, null],
    [{ dateTimeStr: undefined, coordsStr: undefined, addressStr: undefined }, undefined]
  ];
  
  for (let i = 0; i < nullInputs.length; i++) {
    const [d, opts] = nullInputs[i];
    let threw = false;
    try {
      renderWatermark(ctx, 1024, 768, d, opts);
    } catch (e) {
      threw = true;
      console.error(e);
    }
    check(`4.${i + 1} renderWatermark with d=${d === null ? 'null' : typeof d}, opts=${opts === null ? 'null' : typeof opts} does not throw`, !threw);
  }
}

console.log('\n=============================================');
console.log(`Total Checks: ${passed + failed}`);
console.log(`Passed:       ${passed}`);
console.log(`Failed:       ${failed}`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
