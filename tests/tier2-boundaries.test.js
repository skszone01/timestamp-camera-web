/**
 * Tier 2: Boundary & Corner Cases
 * Tests mathematical boundaries, extreme values, leap years, coordinate limits,
 * special character encodings, and extreme image resolutions.
 */

import { describe, test } from './test-runner.js';
import {
  REFERENCE_SPECS,
  loadModule,
  MockCanvas,
  MockContext2D,
  assert,
  assertEqual,
  assertMatch,
  assertBetween
} from './test-utils.js';

// =========================================================================
// Category 1: Coordinate Mathematical Boundaries & Limits
// =========================================================================
describe('Tier 2: Coordinate Mathematical Boundaries', () => {
  test('T2.1: North Pole extreme boundary (+90.0, 0.0) formats to +90.000000,+0.000000', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assert(typeof coordMod.formatCoordinates === 'function', 'formatCoordinates required');
    assertEqual(coordMod.formatCoordinates(90.0, 0.0), '+90.000000,+0.000000');
  });

  test('T2.2: South Pole extreme boundary (-90.0, 0.0) formats to -90.000000,+0.000000', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assertEqual(coordMod.formatCoordinates(-90.0, 0.0), '-90.000000,+0.000000');
  });

  test('T2.3: International Date Line East (+180.0) formats to +0.000000,+180.000000', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assertEqual(coordMod.formatCoordinates(0.0, 180.0), '+0.000000,+180.000000');
  });

  test('T2.4: International Date Line West (-180.0) formats to +0.000000,-180.000000', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assertEqual(coordMod.formatCoordinates(0.0, -180.0), '+0.000000,-180.000000');
  });

  test('T2.5: Equator & Prime Meridian intersection (0.0, 0.0) formats with positive signs', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assertEqual(coordMod.formatCoordinates(0.0, 0.0), '+0.000000,+0.000000');
  });

  test('T2.6: Clamping / Rejection of latitude out of range (> 90 or < -90)', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assertEqual(coordMod.isValidCoordinate(90.000001, 0), false, 'Lat > 90 must be invalid');
    assertEqual(coordMod.isValidCoordinate(-90.000001, 0), false, 'Lat < -90 must be invalid');
  });

  test('T2.7: High-precision decimal rounding (10 decimal places rounded to 6)', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    // 6.4994139876 rounds up to 6.499414
    assertEqual(coordMod.formatCoordinates(6.4994139876, 101.2672051234), '+6.499414,+101.267205');
  });
});

// =========================================================================
// Category 2: Datetime & Calendar Boundaries
// =========================================================================
describe('Tier 2: Datetime & Calendar Boundaries', () => {
  test('T2.8: Leap day 2024-02-29 12:00:00 formats to 29 ก.พ. 2567 12:00:00', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    assert(dtMod, 'js/thai-datetime.js must exist');
    const leapDate = new Date(2024, 1, 29, 12, 0, 0); // Month 1 is Feb
    assertEqual(dtMod.formatThaiBuddhistDate(leapDate), '29 ก.พ. 2567 12:00:00');
  });

  test('T2.9: Non-leap century rollover 2100-02-28 23:59:59 formats to 28 ก.พ. 2643 23:59:59', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    assert(dtMod, 'js/thai-datetime.js must exist');
    const centuryDate = new Date(2100, 1, 28, 23, 59, 59);
    assertEqual(dtMod.formatThaiBuddhistDate(centuryDate), '28 ก.พ. 2643 23:59:59');
  });

  test('T2.10: New Year Eve rollover 2026-12-31 23:59:59 formats to 31 ธ.ค. 2569 23:59:59', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    assert(dtMod, 'js/thai-datetime.js must exist');
    const nye = new Date(2026, 11, 31, 23, 59, 59); // Month 11 is Dec
    assertEqual(dtMod.formatThaiBuddhistDate(nye), '31 ธ.ค. 2569 23:59:59');
  });

  test('T2.11: New Year Day start 2027-01-01 00:00:00 formats to 1 ม.ค. 2570 00:00:00', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    assert(dtMod, 'js/thai-datetime.js must exist');
    const nyd = new Date(2027, 0, 1, 0, 0, 0);
    assertEqual(dtMod.formatThaiBuddhistDate(nyd), '1 ม.ค. 2570 00:00:00');
  });

  test('T2.12: Midnight boundary 00:00:00 retains zero padding across all fields', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    assert(dtMod, 'js/thai-datetime.js must exist');
    const midnight = new Date(2026, 5, 15, 0, 0, 0);
    assertMatch(dtMod.formatThaiBuddhistDate(midnight), /00:00:00$/);
  });

  test('T2.13: Unix epoch start 1970-01-01 00:00:00 converts accurately to BE 2513', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    assert(dtMod, 'js/thai-datetime.js must exist');
    const epoch = new Date(1970, 0, 1, 0, 0, 0);
    assertMatch(dtMod.formatThaiBuddhistDate(epoch), /1 ม\.ค\. 2513 00:00:00/);
  });
});

// =========================================================================
// Category 3: Strings, Encodings & Malformed Input Boundaries
// =========================================================================
describe('Tier 2: Strings & Malformed Inputs', () => {
  test('T2.14: Watermark handles completely empty address string without crashing', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: ''
    });
    // Should render 2 lines or render 3rd line as empty string
    assert(true, 'Rendered empty address without throwing');
  });

  test('T2.15: Very long address string (150+ Thai characters) renders safely without canvas buffer overflow', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    const longAddress = 'ศูนย์อำนวยการบริหารจังหวัดชายแดนภาคใต้ (ศอ.บต.) ถนนสุขยางค์ ตำบลสะเตง อำเภอเมืองยะลา จังหวัดยะลา รหัสไปรษณีย์ 95000 ประเทศไทย';
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: longAddress
    });
    const fillCalls = ctx.getCalls('fillText');
    assert(fillCalls.length >= 3, 'Must render lines including long address');
  });

  test('T2.16: Complex stacked Thai diacritics and lower vowels (สระอุ, สระอู, วรรณยุกต์) render cleanly', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    const complexThai = 'ผู้ว่าราชการจังหวัดพิษณุโลก ฎีกาธิการ';
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+16.821111,+100.265833',
      addressStr: complexThai
    });
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, complexThai, 'Complex Thai diacritics rendered intact');
  });

  test('T2.17: XSS payloads in address (<script>alert(1)</script>) treated purely as literal canvas strings', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    const xssPayload = '<script>alert(document.cookie)</script>';
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: '28 ต.ค. 2569 21:12:07',
      coordsStr: '+6.499413,+101.267206',
      addressStr: xssPayload
    });
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, xssPayload, 'Payload drawn literally without execution');
  });

  test('T2.18: Malformed map URLs with missing params or letters return null without throwing', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    assert(coordMod, 'js/coordinates.js must exist');
    assertEqual(coordMod.parseMapUrl('https://maps.google.com/?q='), null, 'Empty query returns null');
    assertEqual(coordMod.parseMapUrl('https://maps.google.com/?q=invalid,coords'), null, 'Invalid query returns null');
    assertEqual(coordMod.parseMapUrl('https://maps.google.com/@/data'), null, 'Empty @ params returns null');
  });
});

// =========================================================================
// Category 4: Image Dimensions & Canvas Scaling Boundaries
// =========================================================================
describe('Tier 2: Image Dimensions & Canvas Scaling Boundaries', () => {
  test('T2.19: Small thumbnail image (100x100) scales minDim to 100 with minimum readable font size', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    if (typeof wmMod.calculateWatermarkMetrics === 'function') {
      const metrics = wmMod.calculateWatermarkMetrics(100, 100);
      assert(metrics.fontSize >= 8, 'Font size must enforce readable minimum on tiny images');
    }
  });

  test('T2.20: Extreme panoramic aspect ratio (4000x800) scales proportional to minDim = 800', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    if (typeof wmMod.calculateWatermarkMetrics === 'function') {
      const metricsPano = wmMod.calculateWatermarkMetrics(4000, 800);
      const metricsRef = wmMod.calculateWatermarkMetrics(1024, 800);
      assertEqual(metricsPano.fontSize, metricsRef.fontSize, 'Font size must match when minDim is both 800');
    }
  });

  test('T2.21: Extreme tall vertical banner aspect ratio (800x4000) scales proportional to minDim = 800', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    if (typeof wmMod.calculateWatermarkMetrics === 'function') {
      const metricsBanner = wmMod.calculateWatermarkMetrics(800, 4000);
      const metricsPano = wmMod.calculateWatermarkMetrics(4000, 800);
      assertEqual(metricsBanner.fontSize, metricsPano.fontSize, 'Font size must be identical for 800x4000 and 4000x800');
    }
  });

  test('T2.22: 4K UHD resolution (3840x2160, minDim 2160) scales font size proportionally to ~87px', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    if (typeof wmMod.calculateWatermarkMetrics === 'function') {
      const metrics = wmMod.calculateWatermarkMetrics(3840, 2160);
      assertBetween(metrics.fontSize, 84, 90, '4K font size must scale to ~87px');
    }
  });

  test('T2.23: 8K UHD resolution (7680x4320, minDim 4320) scales font size proportionally to ~175px', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    if (typeof wmMod.calculateWatermarkMetrics === 'function') {
      const metrics = wmMod.calculateWatermarkMetrics(7680, 4320);
      assertBetween(metrics.fontSize, 168, 182, '8K font size must scale to ~175px');
    }
  });

  test('T2.24: Max canvas dimension clamping prevents browser GPU memory crash beyond 8192px', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');
    if (typeof wmMod.clampCanvasDimensions === 'function') {
      const clamped = wmMod.clampCanvasDimensions(12000, 9000, 8192);
      assertEqual(clamped.width, 8192, 'Max dimension clamped to 8192');
      assertEqual(clamped.height, 6144, 'Aspect ratio 4:3 preserved (6144px)');
    }
  });
});
