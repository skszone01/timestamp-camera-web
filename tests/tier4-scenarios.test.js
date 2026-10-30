/**
 * Tier 4: Realistic End-User Application Scenarios
 * Full end-to-end simulations of actual user workflows from input to final watermark output:
 * 1. Reference scenario: Sukyang Road, Yala (Authoritative User Request)
 * 2. Bangkok urban scenario: Grand Palace, Phra Nakhon
 * 3. Northern mountain scenario: Doi Inthanon, Chiang Mai
 * 4. Southern island scenario: Patong Beach, Phuket
 * 5. Foreign coordinates scenario: Tokyo Station, Japan
 * 6. Mobile inspection field patrol workflow (Custom checkpoint name + high-res export)
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

describe('Tier 4: Realistic End-User Application Scenarios', () => {

  // =========================================================================
  // Scenario 1: Reference Scenario — Sukyang Road, Yala (ORIGINAL_REQUEST.md)
  // =========================================================================
  test('Scenario 1: Sukyang Road, Yala Reference Scenario (Authoritative Request)', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: geoMod } = await loadModule('geocoder.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && geoMod && wmMod, 'All core engines must exist for Scenario 1');

    // 1. Inputs: 28 Oct 2026 21:12:07 at Sukyang Road, Yala
    const date = new Date(2026, 9, 28, 21, 12, 7);
    const lat = 6.499413;
    const lon = 101.267206;

    // 2. Generate line strings
    const line1 = dtMod.formatThaiBuddhistDate(date);
    const line2 = coordMod.formatCoordinates(lat, lon);
    const line3 = geoMod.lookupOfflineAddress(lat, lon);

    // 3. Verify exact strings matching reference photo
    assertEqual(line1, '28 ต.ค. 2569 21:12:07', 'Line 1 must match reference datetime');
    assertEqual(line2, '+6.499413,+101.267206', 'Line 2 must match reference coordinates');
    assertEqual(line3, 'อ.เมืองยะลา, จ.ยะลา', 'Line 3 must match reference address');

    // 4. Render on 1024x768 reference canvas
    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: line1,
      coordsStr: line2,
      addressStr: line3
    });

    // 5. Verify visual layout metrics
    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3, 'Must render exactly 3 lines');
    assertEqual(fillCalls[0].state.fillStyle, '#ffffff', 'Must have white fill');

    // Verify every line is right-aligned with a ~35px margin (right edge = 1024 - 35 = 989)
    for (const call of fillCalls) {
      assertBetween(MockContext2D.rightEdge(call), 985, 995, 'Right margin must terminate at ~989px');
    }
  });

  // =========================================================================
  // Scenario 2: Bangkok Urban Scenario — Grand Palace, Phra Nakhon
  // =========================================================================
  test('Scenario 2: Bangkok Grand Palace Urban Scenario', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: geoMod } = await loadModule('geocoder.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && geoMod && wmMod, 'All core engines must exist for Scenario 2');

    // Songkran 13 April 2026, 10:30:00 at Grand Palace Bangkok
    const date = new Date(2026, 3, 13, 10, 30, 0); // Month 3 is April
    const lat = 13.750000;
    const lon = 100.491400;

    const line1 = dtMod.formatThaiBuddhistDate(date);
    const line2 = coordMod.formatCoordinates(lat, lon);
    const line3 = geoMod.lookupOfflineAddress(lat, lon);

    assertEqual(line1, '13 เม.ย. 2569 10:30:00', 'Songkran date formatted');
    assertEqual(line2, '+13.750000,+100.491400', 'Signed Bangkok coords');
    assertEqual(line3, 'เขตพระนคร, กรุงเทพมหานคร', 'Bangkok district format without province prefix');

    const canvas = new MockCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1920, 1080, {
      dateTimeStr: line1,
      coordsStr: line2,
      addressStr: line3
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, 'เขตพระนคร, กรุงเทพมหานคร');
  });

  // =========================================================================
  // Scenario 3: Northern Mountain Scenario — Doi Inthanon, Chiang Mai
  // =========================================================================
  test('Scenario 3: Northern Mountain Scenario (Doi Inthanon, Chiang Mai)', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: geoMod } = await loadModule('geocoder.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && geoMod && wmMod, 'All core engines must exist for Scenario 3');

    // New Year Eve sunrise 31 Dec 2026, 06:15:30
    const date = new Date(2026, 11, 31, 6, 15, 30);
    const lat = 18.588889;
    const lon = 98.486944;

    const line1 = dtMod.formatThaiBuddhistDate(date);
    const line2 = coordMod.formatCoordinates(lat, lon);
    const line3 = geoMod.lookupOfflineAddress(lat, lon);

    assertEqual(line1, '31 ธ.ค. 2569 06:15:30');
    assertEqual(line2, '+18.588889,+98.486944');
    assert(line3.includes('เชียงใหม่'), 'Address must resolve to Chiang Mai');

    const canvas = new MockCanvas(4032, 3024); // Standard 12MP smartphone photo
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 4032, 3024, {
      dateTimeStr: line1,
      coordsStr: line2,
      addressStr: line3
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3);
  });

  // =========================================================================
  // Scenario 4: Southern Island Scenario — Patong Beach, Phuket
  // =========================================================================
  test('Scenario 4: Southern Island Scenario (Patong Beach, Phuket)', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: geoMod } = await loadModule('geocoder.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && geoMod && wmMod, 'All core engines must exist for Scenario 4');

    // Sunset 12 Aug 2026, 18:45:00 at Patong Beach
    const date = new Date(2026, 7, 12, 18, 45, 0); // Month 7 is Aug
    const lat = 7.896667;
    const lon = 98.296667;

    const line1 = dtMod.formatThaiBuddhistDate(date);
    const line2 = coordMod.formatCoordinates(lat, lon);
    const line3 = geoMod.lookupOfflineAddress(lat, lon);

    assertEqual(line1, '12 ส.ค. 2569 18:45:00');
    assertEqual(line2, '+7.896667,+98.296667');
    assert(line3.includes('ภูเก็ต'), 'Address must resolve to Phuket');
  });

  // =========================================================================
  // Scenario 5: Foreign Coordinates Scenario — Tokyo Station, Japan
  // =========================================================================
  test('Scenario 5: Foreign Coordinates Graceful Handling (Tokyo Station)', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: geoMod } = await loadModule('geocoder.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && geoMod && wmMod, 'All core engines must exist for Scenario 5');

    // Tokyo Station 1 Jan 2026 12:00:00
    const date = new Date(2026, 0, 1, 12, 0, 0);
    const lat = 35.681236;
    const lon = 139.767125;

    const line1 = dtMod.formatThaiBuddhistDate(date);
    const line2 = coordMod.formatCoordinates(lat, lon);
    const line3 = geoMod.lookupOfflineAddress(lat, lon);

    assertEqual(line1, '1 ม.ค. 2569 12:00:00');
    assertEqual(line2, '+35.681236,+139.767125');
    assert(line3 !== undefined, 'Foreign coordinates must not return undefined or throw');

    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: line1,
      coordsStr: line2,
      addressStr: line3 || 'พิกัดต่างประเทศ'
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls.length, 3, 'Must render without exception');
  });

  // =========================================================================
  // Scenario 6: Mobile Inspection Field Patrol Workflow
  // =========================================================================
  test('Scenario 6: Mobile Field Inspector Checkpoint Workflow with Manual Custom Name', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && wmMod, 'Engines required for Scenario 6');

    // Inspector at checkpoint enters custom title
    const date = new Date(2026, 9, 29, 14, 0, 0);
    const lat = 6.541100;
    const lon = 101.281300;
    const customTitle = 'จุดตรวจขุนไวย์ มว.ฉก.ตร.ยะลา 9123';

    const line1 = dtMod.formatThaiBuddhistDate(date);
    const line2 = coordMod.formatCoordinates(lat, lon);
    const line3 = customTitle;

    assertEqual(line1, '29 ต.ค. 2569 14:00:00');
    assertEqual(line2, '+6.541100,+101.281300');

    // Render full-resolution 4032x3024 checkpoint inspection photo
    const canvas = new MockCanvas(4032, 3024);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 4032, 3024, {
      dateTimeStr: line1,
      coordsStr: line2,
      addressStr: line3
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[2].args.text, customTitle, 'Custom checkpoint name cleanly embedded');
  });
});
