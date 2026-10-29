/**
 * timestamp-camera-web/tests/adversarial-m1-2.test.js
 * 
 * Challenger 2 Adversarial Stress & Verification Harness for Milestone M1-CORE.
 * 
 * Validates:
 * 1. Reverse Geocoder boundary, border towns & 5,000+ random Thai points
 * 2. Spatial lookup execution speed benchmark (< 0.1ms SLA)
 * 3. Presets rapid CRUD, limit enforcement & factory preset deletion protection
 * 4. LocalStorage QuotaExceededError simulation and resilience
 * 5. International coordinates and input type safety (null/undefined/NaN)
 */

import {
  THAI_SPATIAL_INDEX,
  lookupOfflineAddress,
  formatThaiAddress,
  parseNominatimAddress,
  resolveThaiAddress,
  clearAddressCache
} from '../js/geocoder.js';

import {
  DEFAULT_PRESETS,
  validatePresetInput,
  getDefaultPresets,
  getCustomPresets,
  getAllPresets,
  saveCustomPreset,
  deleteCustomPreset,
  clearCustomPresets
} from '../js/presets.js';

// Minimal mock storage for headless Node environment
class MockStorage {
  constructor() {
    this.store = new Map();
    this.shouldThrowQuota = false;
  }
  getItem(k) {
    return this.store.has(k) ? this.store.get(k) : null;
  }
  setItem(k, v) {
    if (this.shouldThrowQuota) {
      const err = new Error('QuotaExceededError: DOM Exception 22');
      err.name = 'QuotaExceededError';
      err.code = 22;
      throw err;
    }
    this.store.set(k, String(v));
  }
  removeItem(k) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

const mockStorage = new MockStorage();
globalThis.localStorage = mockStorage;
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true
});

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  findings: []
};

function recordTest(name, passed, detail = '') {
  results.total++;
  if (passed) {
    results.passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    results.failed++;
    console.error(`  [FAIL] ${name}: ${detail}`);
    results.findings.push({ name, detail });
  }
}

async function runAdversarialSuite() {
  console.log('\n======================================================');
  console.log(' Challenger 2: Adversarial Stress & Benchmark Suite   ');
  console.log('======================================================\n');

  // -------------------------------------------------------------------------
  // SECTION 1: Geocoder Stress Testing Across Thailand
  // -------------------------------------------------------------------------
  console.log('--- 1. Geocoder Stress Testing (5,000 Coordinates) ---');
  {
    const COUNT = 5000;
    const validPattern = /^((อ\.[^,]+|เมืองพัทยา), จ\.[^,]+|เขต[^,]+, กรุงเทพมหานคร)$/;
    let formatFailures = 0;
    let exceptionFailures = 0;

    for (let i = 0; i < COUNT; i++) {
      // Random coordinates inside Thailand mainland bounding box
      const lat = 5.61 + Math.random() * (20.45 - 5.61);
      const lon = 97.35 + Math.random() * (105.65 - 97.35);

      try {
        const addr = lookupOfflineAddress(lat, lon);
        if (typeof addr !== 'string' || !validPattern.test(addr)) {
          formatFailures++;
        }
      } catch (err) {
        exceptionFailures++;
      }
    }

    recordTest(
      `5,000 random Thai coordinates produce valid administrative addresses`,
      formatFailures === 0 && exceptionFailures === 0,
      `formatFailures=${formatFailures}, exceptions=${exceptionFailures}`
    );
  }

  // -------------------------------------------------------------------------
  // SECTION 2: Border Towns Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Border Towns & Boundary Points ---');
  {
    const borderPoints = [
      { name: 'Mae Sai border checkpoint (Chiang Rai)', lat: 20.4433, lon: 99.8805, expectedProvince: 'เชียงราย' },
      { name: 'Betong border checkpoint (Yala)', lat: 5.7743, lon: 101.0712, expectedProvince: 'ยะลา' },
      { name: 'Betong southernmost marker (Yala)', lat: 5.6133, lon: 101.1350, expectedProvince: 'ยะลา' },
      { name: 'Sungai Kolok border (Narathiwat)', lat: 6.0272, lon: 101.9667, expectedProvince: 'นราธิวาส' },
      { name: 'Trat border Ban Hat Lek', lat: 11.8333, lon: 102.8333, expectedProvince: 'ตราด' },
      { name: 'Tak border Mae Sot', lat: 16.7167, lon: 98.5667, expectedProvince: 'ตาก' },
      { name: 'Kanchanaburi Three Pagodas Pass', lat: 15.2933, lon: 98.3967, expectedProvince: 'ตาก' } // nearest centroid in index
    ];

    let allBorderValid = true;
    for (const pt of borderPoints) {
      const addr = lookupOfflineAddress(pt.lat, pt.lon);
      const ok = typeof addr === 'string' && addr.includes(pt.expectedProvince);
      if (!ok) {
        allBorderValid = false;
        console.error(`    Mismatch on ${pt.name}: got "${addr}", expected province "${pt.expectedProvince}"`);
      }
    }
    recordTest('Border towns resolve to valid nearby Thai province centroids', allBorderValid);
  }

  // -------------------------------------------------------------------------
  // SECTION 3: International Coordinates Graceful Resolution
  // -------------------------------------------------------------------------
  console.log('\n--- 3. International Coordinates Graceful Resolution ---');
  {
    const foreignPoints = [
      { name: 'Tokyo Station', lat: 35.681236, lon: 139.767125 },
      { name: 'London Big Ben', lat: 51.5007, lon: -0.1246 },
      { name: 'New York Times Square', lat: 40.7580, lon: -73.9855 },
      { name: 'Sydney Opera House', lat: -33.8568, lon: 151.2153 },
      { name: 'Equator Prime Meridian', lat: 0.0, lon: 0.0 },
      { name: 'North Pole', lat: 90.0, lon: 0.0 },
      { name: 'South Pole', lat: -90.0, lon: 0.0 },
      { name: 'Malaysia outside box', lat: 4.80, lon: 101.00 },
      { name: 'Myanmar outside box', lat: 21.50, lon: 99.00 }
    ];

    let foreignPassed = true;
    for (const fp of foreignPoints) {
      try {
        const addr = lookupOfflineAddress(fp.lat, fp.lon);
        if (addr !== '') {
          foreignPassed = false;
          console.error(`    Foreign coord ${fp.name} returned non-empty offline address: "${addr}"`);
        }
      } catch (err) {
        foreignPassed = false;
        console.error(`    Foreign coord ${fp.name} threw exception: ${err.message}`);
      }
    }
    recordTest('Foreign coordinates outside Thailand return empty string without throwing', foreignPassed);
  }

  // -------------------------------------------------------------------------
  // SECTION 4: Spatial Lookup Execution Benchmark (< 0.1ms SLA)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Execution Speed Benchmark (< 0.1ms SLA) ---');
  {
    const BENCH_COUNT = 100000;
    const lats = new Float64Array(BENCH_COUNT);
    const lons = new Float64Array(BENCH_COUNT);
    for (let i = 0; i < BENCH_COUNT; i++) {
      lats[i] = 5.6 + Math.random() * (20.4 - 5.6);
      lons[i] = 97.4 + Math.random() * (105.7 - 97.4);
    }

    // Warmup
    for (let i = 0; i < 1000; i++) lookupOfflineAddress(lats[i], lons[i]);

    const t0 = performance.now();
    for (let i = 0; i < BENCH_COUNT; i++) {
      lookupOfflineAddress(lats[i], lons[i]);
    }
    const elapsedMs = performance.now() - t0;
    const avgMs = elapsedMs / BENCH_COUNT;
    const avgMicroSec = avgMs * 1000;

    console.log(`    Executed ${BENCH_COUNT} lookups in ${elapsedMs.toFixed(2)}ms`);
    console.log(`    Average time per lookup: ${avgMs.toFixed(6)}ms (${avgMicroSec.toFixed(3)} µs)`);
    console.log(`    Throughput: ${(BENCH_COUNT / (elapsedMs / 1000)).toFixed(0)} lookups/sec`);

    recordTest(
      `Spatial lookup average latency is strictly < 0.1ms (${avgMs.toFixed(6)}ms)`,
      avgMs < 0.1,
      `Expected < 0.1ms, actual ${avgMs}ms`
    );
  }

  // -------------------------------------------------------------------------
  // SECTION 5: Presets Rapid CRUD & Limit Clamping
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Presets Rapid CRUD & Capacity Clamping ---');
  {
    clearCustomPresets();
    mockStorage.shouldThrowQuota = false;

    // Insert 120 presets rapidly
    for (let i = 1; i <= 120; i++) {
      saveCustomPreset({
        name: `Checkpoint ${i}`,
        lat: 13.0 + (i * 0.001),
        lon: 100.0 + (i * 0.001),
        address: `อ.เมือง, จ.ทดสอบ ${i}`
      });
    }

    const customs = getCustomPresets();
    recordTest(
      'MAX_CUSTOM_PRESETS limit strictly clamped to 50 items after 120 insertions',
      customs.length === 50,
      `Expected 50, got ${customs.length}`
    );

    // Verify LIFO order (most recent at head)
    const newest = customs[0];
    recordTest(
      'Newest inserted preset is at index 0 (LIFO ordering)',
      newest.name === 'Checkpoint 120',
      `Expected 'Checkpoint 120', got '${newest?.name}'`
    );

    // Update existing preset in place
    const targetId = newest.id;
    saveCustomPreset({
      id: targetId,
      name: 'Checkpoint 120 UPDATED',
      lat: 13.999,
      lon: 100.999,
      address: 'อ.เมือง, จ.อัปเดต'
    });

    const customsAfterUpdate = getCustomPresets();
    const updated = customsAfterUpdate.find(p => p.id === targetId);
    recordTest(
      'Existing preset successfully updated in place by ID',
      updated && updated.name === 'Checkpoint 120 UPDATED' && customsAfterUpdate.length === 50,
      `Updated name: ${updated?.name}, length: ${customsAfterUpdate.length}`
    );

    // Delete custom preset
    const delRes = deleteCustomPreset(targetId);
    const customsAfterDel = getCustomPresets();
    recordTest(
      'Custom preset deleted by ID and removed from store',
      delRes === true && customsAfterDel.length === 49,
      `delRes=${delRes}, count=${customsAfterDel.length}`
    );

    clearCustomPresets();
  }

  // -------------------------------------------------------------------------
  // SECTION 6: Default Factory Presets Deletion Protection
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Factory Presets Deletion Protection ---');
  {
    const defaults = getDefaultPresets();
    let allProtected = true;

    for (const p of defaults) {
      const delSuccess = deleteCustomPreset(p.id);
      if (delSuccess !== false) {
        allProtected = false;
        console.error(`    CRITICAL: deleteCustomPreset returned true for factory preset ${p.id}`);
      }
    }

    const defaultsAfter = getDefaultPresets();
    const allPresets = getAllPresets();

    recordTest(
      'All 8 default factory presets cannot be deleted via deleteCustomPreset',
      allProtected && defaultsAfter.length === 8 && allPresets.length === 8
    );

    // Immutability test on getDefaultPresets()
    defaults[0].name = 'MUTATED NAME';
    const freshDefaults = getDefaultPresets();
    recordTest(
      'getDefaultPresets() returns cloned objects, mutating them does not corrupt factory defaults',
      freshDefaults[0].name !== 'MUTATED NAME'
    );
  }

  // -------------------------------------------------------------------------
  // SECTION 7: LocalStorage QuotaExceededError Simulation
  // -------------------------------------------------------------------------
  console.log('\n--- 7. LocalStorage QuotaExceededError Resilience ---');
  {
    clearCustomPresets();
    // Simulate quota exhaustion
    mockStorage.shouldThrowQuota = true;

    const saved = saveCustomPreset({
      name: 'Quota Test Checkpoint',
      lat: 13.75,
      lon: 100.49,
      address: 'เขตพระนคร, กรุงเทพมหานคร'
    });

    // Did saveCustomPreset survive the exception without crashing?
    const survivedSave = saved !== null && typeof saved === 'object';

    // Can getCustomPresets() retrieve the in-memory preset when localStorage threw QuotaExceededError?
    const customs = getCustomPresets();
    const retrievedFromMemory = customs.some(p => p.id === saved?.id);

    recordTest(
      'saveCustomPreset catches QuotaExceededError and returns saved preset object',
      survivedSave
    );

    recordTest(
      'getCustomPresets() retrieves saved preset from in-memory fallback when localStorage is full',
      retrievedFromMemory,
      `BUG CONFIRMED: getCustomPresets() returned ${customs.length} items; in-memory fallback ignored when localStorage object exists`
    );

    mockStorage.shouldThrowQuota = false;
    clearCustomPresets();
  }

  // -------------------------------------------------------------------------
  // SECTION 8: Geocoder Input Type Safety (Null / Undefined / Non-Number)
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Geocoder Input Type Safety ---');
  {
    let resolveNullThrew = false;
    let resolveUndefThrew = false;
    let resolveStrThrew = false;

    try {
      await resolveThaiAddress(null, null);
    } catch (e) {
      resolveNullThrew = true;
    }

    try {
      await resolveThaiAddress(undefined, undefined);
    } catch (e) {
      resolveUndefThrew = true;
    }

    try {
      await resolveThaiAddress('13.75', '100.49');
    } catch (e) {
      resolveStrThrew = true;
    }

    recordTest(
      'resolveThaiAddress(null, null) safely returns without throwing TypeError',
      !resolveNullThrew,
      'BUG CONFIRMED: Throws TypeError: Cannot read properties of null (reading "toFixed")'
    );

    recordTest(
      'resolveThaiAddress(undefined, undefined) safely returns without throwing TypeError',
      !resolveUndefThrew,
      'BUG CONFIRMED: Throws TypeError: Cannot read properties of undefined (reading "toFixed")'
    );

    recordTest(
      'resolveThaiAddress("13.75", "100.49") safely returns without throwing TypeError',
      !resolveStrThrew,
      'BUG CONFIRMED: Throws TypeError: lat.toFixed is not a function'
    );
  }

  // -------------------------------------------------------------------------
  // SECTION 9: Geocoder Debounce Superseded Promise Resolution
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Geocoder Debounce Superseded Promise Resolution ---');
  {
    let p1Settled = false;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ address: { suburb: 'เขตพระนคร', province: 'กรุงเทพมหานคร' } })
    });

    const p1 = resolveThaiAddress(13.7501, 100.4901).then(() => {
      p1Settled = true;
    }).catch(() => {
      p1Settled = true;
    });

    // Call 2 arrives 50ms later before debounce fires
    await new Promise(r => setTimeout(r, 50));
    const p2 = resolveThaiAddress(13.7601, 100.5001);

    // Wait 1200ms for debounce timer to settle
    await new Promise(r => setTimeout(r, 1200));

    recordTest(
      'Superseded debounced promise (Call 1) settles cleanly and does not hang indefinitely',
      p1Settled,
      'BUG CONFIRMED: Call 1 promise leaks and hangs forever because its setTimeout was cleared'
    );
  }

  // -------------------------------------------------------------------------
  // FINAL REPORT
  // -------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(` Adversarial Test Summary: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
  console.log('======================================================');

  if (results.findings.length > 0) {
    console.log('\nFailure Modes Discovered:');
    results.findings.forEach((f, idx) => {
      console.log(`  ${idx + 1}. ${f.name}`);
      console.log(`     Details: ${f.detail}`);
    });
  }

  return results;
}

runAdversarialSuite().then((res) => {
  process.exit(res.failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
