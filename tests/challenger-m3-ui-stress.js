/**
 * tests/challenger-m3-ui-stress.js
 * 
 * EMPIRICAL ADVERSARIAL STRESS HARNESS — MILESTONE M3-UI
 * Challenger: challenger_m3_1
 * 
 * Verifies and stress-tests:
 * 1. Leaflet SVG DivIcon Inspection & Asset Integrity (zero external PNGs/404s)
 * 2. Universal Map Link & Coordinate Parser Stress (Google, Apple, OSM, DMS, Malicious)
 * 3. Bi-directional Coordinate Sync & Stress (200 rapid drags, taps, OOB [-95, 200], NaN)
 * 4. Manual Address Locking & Override Protection (custom checkpoint preservation)
 * 5. Presets Switching & Storage Churn Stress (rapid switching, quota errors, custom bookmarks)
 * 6. Application Wiring & Integration Forensics (Leaflet map initialization, DOM element bindings)
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
  MockLocalStorage,
  setMockLocalStorage,
  setMockNavigator,
  assert,
  assertEqual,
  assertMatch
} from './test-utils.js';

import {
  DEFAULT_COORDINATES,
  getPinSvgMarkup,
  createPinIcon,
  setMapCoordinates,
  getMapCoordinates,
  handleUrlPaste,
  bindCoordinateInputs,
  setManualAddressLock,
  isManualAddressLockedState,
  destroyMap,
  initMap
} from '../js/map-picker.js';

import {
  DEFAULT_STATE,
  appState,
  getState,
  subscribe,
  setImage,
  setDateTime,
  setCustomDateTime,
  setLiveTime,
  tickLiveTime,
  updateCoordinates,
  setAddress,
  setManualAddress,
  unlockAddress,
  selectPreset,
  applyExifMetadata,
  resetDefaults
} from '../js/state.js';

import {
  DEFAULT_PRESETS,
  getDefaultPresets,
  getCustomPresets,
  getAllPresets,
  saveCustomPreset,
  deleteCustomPreset,
  clearCustomPresets,
  validatePresetInput
} from '../js/presets.js';

import {
  isValidCoordinate,
  formatCoordinates,
  formatSignedComponent,
  parseCoordinatePair,
  parseDMS,
  parseMapUrl,
  parseLocationInput
} from '../js/coordinates.js';

import {
  generateExportFilename,
  canUseWebShare,
  exportImage
} from '../js/export-manager.js';

const PROJECT_ROOT = path.resolve(url.fileURLToPath(import.meta.url), '../..');

// Summary tracking
const summary = {
  total: 0,
  passed: 0,
  failed: 0,
  failures: [],
  findings: []
};

function check(testName, fn) {
  summary.total++;
  try {
    fn();
    summary.passed++;
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    summary.failed++;
    const msg = `${testName} -> ${err.message}`;
    summary.failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

async function checkAsync(testName, fn) {
  summary.total++;
  try {
    await fn();
    summary.passed++;
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    summary.failed++;
    const msg = `${testName} -> ${err.message}`;
    summary.failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

function recordFinding(severity, id, title, details) {
  summary.findings.push({ severity, id, title, details });
  console.warn(`  [FINDING - ${severity}] ${id}: ${title}`);
}

console.log('===========================================================');
console.log('          M3-UI EMPIRICAL ADVERSARIAL STRESS SUITE         ');
console.log('===========================================================\n');

// =========================================================================
// SECTION 1: Leaflet SVG DivIcon Inspection & Asset Integrity
// =========================================================================
console.log('--- SECTION 1: Leaflet SVG DivIcon & Zero-PNG Integrity ---');

check('S1.1: getPinSvgMarkup generates valid standalone SVG markup', () => {
  const markup = getPinSvgMarkup();
  assert(typeof markup === 'string' && markup.length > 50, 'Markup must be non-empty string');
  assert(markup.includes('<svg'), 'Must contain <svg> tag');
  assert(markup.includes('</svg>'), 'Must close </svg> tag');
  assert(markup.includes('viewBox="0 0 32 42"'), 'Must define 32x42 viewBox');
  assert(markup.includes('tc-pin-wrapper'), 'Must contain wrapper div');
  assert(markup.includes('tc-pin-pulse'), 'Must contain pulse ring div');
});

check('S1.2: DivIcon contains ZERO external image URLs (.png, .jpg, .gif, .svg, http asset fetches)', () => {
  const markup = getPinSvgMarkup();
  assert(!/\.(png|jpg|jpeg|gif|webp)/i.test(markup), 'DivIcon must not reference raster images');
  // Ignore standard XML namespace xmlns="http://www.w3.org/2000/svg"
  const sanitized = markup.replace(/xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/, '');
  assert(!/(src|href|url)\s*=\s*["']?https?:\/\//i.test(sanitized), 'DivIcon must not make external HTTP image requests');
});

check('S1.3: createPinIcon generates valid Leaflet icon descriptor with optical anchors', () => {
  const icon = createPinIcon();
  assert(icon !== null && typeof icon === 'object', 'Icon descriptor must be an object');
  assertEqual(icon.className, 'tc-leaflet-custom-pin', 'Must use tc-leaflet-custom-pin class');
  assert(Array.isArray(icon.iconSize) && icon.iconSize[0] === 32 && icon.iconSize[1] === 42, 'iconSize must be [32, 42]');
  assert(Array.isArray(icon.iconAnchor) && icon.iconAnchor[0] === 16 && icon.iconAnchor[1] === 42, 'iconAnchor tip must be [16, 42]');
  assert(Array.isArray(icon.popupAnchor) && icon.popupAnchor[0] === 0 && icon.popupAnchor[1] === -42, 'popupAnchor must be [0, -42]');
});

check('S1.4: createPinIcon integrates with mock L.divIcon seamlessly', () => {
  let divIconCalled = false;
  const mockL = {
    divIcon(cfg) {
      divIconCalled = true;
      return { ...cfg, _isLeafletDivIcon: true };
    }
  };
  const icon = createPinIcon({ L: mockL });
  assert(divIconCalled, 'L.divIcon must be called when L is present');
  assertEqual(icon._isLeafletDivIcon, true, 'Result is wrapped by L.divIcon');
});

// =========================================================================
// SECTION 2: Universal Map Link & Coordinate Parser Adversarial Stress
// =========================================================================
console.log('\n--- SECTION 2: Universal Map Link & Coordinate Parser Stress ---');

const linkTestVectors = [
  // Google Maps @lat,lon,zoom
  { name: 'Google Maps standard @ URL', url: 'https://www.google.com/maps/@13.750000,100.491400,17z', lat: 13.75, lon: 100.4914 },
  { name: 'Google Maps place @ URL', url: 'https://www.google.com/maps/place/Grand+Palace/@13.750000,100.491400,15z/data=!4m5', lat: 13.75, lon: 100.4914 },
  { name: 'Google Maps desktop !3d!4d data', url: 'https://www.google.com/maps/place/X/data=!3m1!4b1!4m6!3m5!1s0x0!8m2!3d6.499413!4d101.267206', lat: 6.499413, lon: 101.267206 },
  { name: 'Google Maps ?q=lat,lon query', url: 'https://maps.google.com/?q=6.499413,101.267206', lat: 6.499413, lon: 101.267206 },
  { name: 'Google Maps ?q=loc:lat,lon', url: 'https://maps.google.com/?q=loc:18.7883,98.9853', lat: 18.7883, lon: 98.9853 },
  { name: 'Google Maps ?ll= query', url: 'https://maps.google.com/?ll=7.8841,98.3908', lat: 7.8841, lon: 98.3908 },
  { name: 'Google short URL with ?q= query', url: 'https://maps.app.goo.gl/?q=13.750000,100.491400', lat: 13.75, lon: 100.4914 },
  { name: 'Goo.gl short URL with ?q= query', url: 'https://goo.gl/maps/?q=6.499413,101.267206', lat: 6.499413, lon: 101.267206 },
  // Apple Maps
  { name: 'Apple Maps ?ll= query', url: 'https://maps.apple.com/?ll=18.588889,98.486944&q=Doi+Inthanon', lat: 18.588889, lon: 98.486944 },
  { name: 'Apple Maps ?q= query', url: 'https://maps.apple.com/?q=14.9739,102.1039', lat: 14.9739, lon: 102.1039 },
  // OpenStreetMap
  { name: 'OSM hash #map=zoom/lat/lon', url: 'https://www.openstreetmap.org/#map=16/7.896667/98.296667', lat: 7.896667, lon: 98.296667 },
  { name: 'OSM query ?lat=...&lon=...', url: 'https://www.openstreetmap.org/?lat=16.417200&lon=102.835800', lat: 16.4172, lon: 102.8358 },
  // Geo URI
  { name: 'Geo URI standard', url: 'geo:6.499413,101.267206', lat: 6.499413, lon: 101.267206 },
  // DMS strings
  { name: 'DMS string North/East', url: '6°29\'57.9"N 101°16\'01.9"E', lat: 6.499417, lon: 101.267194 },
  { name: 'DMS string South/West', url: '12°20\'00"S 77°01\'00"W', lat: -12.333333, lon: -77.016667 },
  // Plain Coordinate strings
  { name: 'Plain coordinate with signs', url: '+6.499413,+101.267206', lat: 6.499413, lon: 101.267206 },
  { name: 'Plain coordinate space separated', url: '13.750000 100.491400', lat: 13.75, lon: 100.4914 }
];

for (const vec of linkTestVectors) {
  check(`S2.Link: ${vec.name}`, () => {
    const res = parseLocationInput(vec.url);
    assert(res !== null, `Failed to parse: ${vec.url}`);
    const latDiff = Math.abs(res.lat - vec.lat);
    const lonDiff = Math.abs(res.lon - vec.lon);
    assert(latDiff < 0.0001, `Lat mismatch: expected ${vec.lat}, got ${res.lat}`);
    assert(lonDiff < 0.0001, `Lon mismatch: expected ${vec.lon}, got ${res.lon}`);
  });
}

check('S2.Paste: handleUrlPaste moves coordinates accurately', () => {
  const parsed = handleUrlPaste('https://www.google.com/maps/@18.7883,98.9853,16z');
  assert(parsed !== null, 'handleUrlPaste must return parsed object');
  assertEqual(parsed.lat, 18.7883, 'Lat matched');
  assertEqual(parsed.lon, 98.9853, 'Lon matched');
  const current = getMapCoordinates();
  assertEqual(current.lat, 18.7883, 'Map marker lat synchronized');
  assertEqual(current.lon, 98.9853, 'Map marker lon synchronized');
});

// Adversarial input fuzzing
const maliciousVectors = [
  '<script>alert(1)</script>',
  'javascript:void(0)',
  'https://malicious.com/?q=NaN,NaN',
  'https://maps.google.com/?q=DROP+TABLE+users;--',
  'https://maps.google.com/?q=9999999999999999999999,999999999999999999999',
  'https://maps.google.com/@/data',
  'https://maps.google.com/?q=',
  '',
  '    ',
  'null',
  'undefined',
  '{}',
  '[]',
  'NaN,NaN',
  '-95.0,200.0',
  '90.000001,180.000001'
];

check('S2.Fuzz: 16 Malicious & OOB inputs fail safely without throwing', () => {
  for (const malicious of maliciousVectors) {
    let threw = false;
    let res = null;
    try {
      res = handleUrlPaste(malicious);
    } catch {
      threw = true;
    }
    assert(!threw, `handleUrlPaste threw exception on: ${malicious}`);
    assertEqual(res, null, `Malicious input must return null: ${malicious}`);
  }
});

// =========================================================================
// SECTION 3: Bi-Directional Coordinate Sync & Rapid Churn Stress
// =========================================================================
console.log('\n--- SECTION 3: Bi-directional Coordinate Sync & Churn Stress ---');

check('S3.1: 200 Rapid simulated marker coordinate changes maintain precision', () => {
  for (let i = 0; i < 200; i++) {
    // Generate valid Thai coordinates roughly within lat [5.5, 20.5], lon [97.5, 105.5]
    const lat = parseFloat((5.5 + (i * 0.075)).toFixed(6));
    const lon = parseFloat((97.5 + (i * 0.04)).toFixed(6));

    const updated = setMapCoordinates(lat, lon, false, { silent: false });
    assert(updated !== null, `setMapCoordinates failed at step ${i}`);
    assertEqual(updated.lat, lat, `Lat mismatch at step ${i}`);
    assertEqual(updated.lon, lon, `Lon mismatch at step ${i}`);

    const current = getMapCoordinates();
    assertEqual(current.lat, lat, `getMapCoordinates lat mismatch at step ${i}`);
    assertEqual(current.lon, lon, `getMapCoordinates lon mismatch at step ${i}`);
  }
});

check('S3.2: Out-of-bounds coordinates [-95, 200] and non-numeric values rejected', () => {
  const before = getMapCoordinates();

  assertEqual(setMapCoordinates(-95, 100), null, 'Lat -95 rejected');
  assertEqual(setMapCoordinates(95, 100), null, 'Lat 95 rejected');
  assertEqual(setMapCoordinates(13, -185), null, 'Lon -185 rejected');
  assertEqual(setMapCoordinates(13, 185), null, 'Lon 185 rejected');
  assertEqual(setMapCoordinates(NaN, 100), null, 'NaN lat rejected');
  assertEqual(setMapCoordinates(13, NaN), null, 'NaN lon rejected');
  assertEqual(setMapCoordinates('invalid', 'text'), null, 'Text rejected');
  assertEqual(setMapCoordinates(Infinity, 100), null, 'Infinity rejected');

  const after = getMapCoordinates();
  assertEqual(after.lat, before.lat, 'Lat preserved on rejected input');
  assertEqual(after.lon, before.lon, 'Lon preserved on rejected input');
});

check('S3.3: Mock DOM Coordinate Input Binding & Active Element Protection', () => {
  // Mock DOM Input elements
  const mockLatInput = { value: '', addEventListener: () => {}, removeEventListener: () => {} };
  const mockLonInput = { value: '', addEventListener: () => {}, removeEventListener: () => {} };

  // Set global document mock with activeElement
  const originalDoc = globalThis.document;
  globalThis.document = { activeElement: null };

  const unbind = bindCoordinateInputs({
    latInput: mockLatInput,
    lonInput: mockLonInput
  });

  try {
    // Update coordinates while NOT focused
    setMapCoordinates(13.75, 100.4914);
    assertEqual(mockLatInput.value, '+13.750000', 'latInput populated with formatted + sign');
    assertEqual(mockLonInput.value, '+100.491400', 'lonInput populated with formatted + sign');

    // Simulate USER actively typing into latInput (activeElement === latInput)
    globalThis.document.activeElement = mockLatInput;
    mockLatInput.value = '18.7'; // User halfway through typing

    setMapCoordinates(18.7883, 98.9853);
    // Lat input must NOT be overwritten while user is actively typing!
    assertEqual(mockLatInput.value, '18.7', 'latInput not overwritten while actively focused');
    assertEqual(mockLonInput.value, '+98.985300', 'lonInput updated while not focused');
  } finally {
    unbind();
    globalThis.document = originalDoc;
  }
});

// =========================================================================
// SECTION 4: Manual Address Locking & Override Protection
// =========================================================================
console.log('\n--- SECTION 4: Manual Address Locking & Override Protection ---');

check('S4.1: Manual address edit locks address field and sets isAddressManual flag', () => {
  resetDefaults();
  assertEqual(appState.isAddressManual, false, 'Default isAddressManual must be false');

  const customAddress = 'จุดตรวจเฉพาะกิจ 9123 มว.ฉก.ตร.ยะลา';
  setManualAddress(customAddress);

  assertEqual(appState.address, customAddress, 'Address set to custom string');
  assertEqual(appState.isAddressManual, true, 'isAddressManual set to true');
});

check('S4.2: 50 Rapid coordinate updates do NOT overwrite manual custom address', () => {
  const customAddress = 'จุดตรวจเฉพาะกิจ 9123 มว.ฉก.ตร.ยะลา';
  setManualAddress(customAddress);

  const testCoords = [
    { lat: 13.750000, lon: 100.491400 }, // Bangkok
    { lat: 18.787747, lon: 98.993134 },  // Chiang Mai
    { lat: 7.884100, lon: 98.390800 },   // Phuket
    { lat: 16.417200, lon: 102.835800 }, // Khon Kaen
    { lat: 12.927600, lon: 100.877100 }  // Pattaya
  ];

  for (let cycle = 0; cycle < 10; cycle++) {
    for (const c of testCoords) {
      updateCoordinates(c.lat, c.lon);
      assertEqual(appState.address, customAddress, `Address overwritten during cycle ${cycle} at ${c.lat},${c.lon}!`);
      assertEqual(appState.isAddressManual, true, 'Lock must remain active');
    }
  }
});

check('S4.3: EXIF GPS import does NOT overwrite manual custom address', () => {
  const customAddress = 'จุดตรวจเฉพาะกิจ 9123 มว.ฉก.ตร.ยะลา';
  setManualAddress(customAddress);

  applyExifMetadata({
    latitude: 18.7883,
    longitude: 98.9853,
    dateTime: new Date(2026, 9, 28, 12, 0, 0)
  });

  assertEqual(appState.lat, 18.7883, 'EXIF lat applied');
  assertEqual(appState.lon, 98.9853, 'EXIF lon applied');
  assertEqual(appState.address, customAddress, 'Custom address strictly preserved across EXIF GPS import');
});

check('S4.4: unlockAddress unlocks field and allows auto-geocoder to resume', () => {
  unlockAddress();
  assertEqual(appState.isAddressManual, false, 'isAddressManual false after unlock');

  // Now update coordinates to Bangkok Grand Palace
  updateCoordinates(13.750000, 100.491400);
  assertEqual(appState.address, 'เขตพระนคร, กรุงเทพมหานคร', 'Auto-geocoder resumed updating address');
});

check('S4.5: selectPreset clears manual lock and applies preset address', () => {
  setManualAddress('จุดตรวจเฉพาะกิจ 9123');
  assertEqual(appState.isAddressManual, true);

  selectPreset('preset_cnx_thaphae');
  assertEqual(appState.isAddressManual, false, 'Manual lock cleared on preset selection');
  assertEqual(appState.address, 'อ.เมืองเชียงใหม่, จ.เชียงใหม่', 'Preset address applied');
  assertEqual(appState.lat, 18.787747, 'Preset lat applied');
});

// =========================================================================
// SECTION 5: Presets Switching & Storage Churn Stress
// =========================================================================
console.log('\n--- SECTION 5: Presets Switching & Storage Churn Stress ---');

check('S5.1: 50 Rapid preset switching cycles across all 8 factory presets', () => {
  const presets = getDefaultPresets();
  assertEqual(presets.length, 8, '8 Default presets must exist');

  for (let i = 0; i < 50; i++) {
    const p = presets[i % presets.length];
    const success = selectPreset(p.id);
    assert(success, `Failed to select preset ${p.id}`);
    assertEqual(appState.lat, p.lat, `Lat mismatch on preset ${p.id}`);
    assertEqual(appState.lon, p.lon, `Lon mismatch on preset ${p.id}`);
    assertEqual(appState.address, p.address, `Address mismatch on preset ${p.id}`);
    assertEqual(appState.selectedPresetId, p.id, `selectedPresetId mismatch on preset ${p.id}`);
  }
});

check('S5.2: Custom preset creation, persistence, and deduplication', () => {
  const mockStorage = new MockLocalStorage();
  setMockLocalStorage(mockStorage);
  clearCustomPresets();

  const custom1 = saveCustomPreset({
    id: 'my_custom_cp_1',
    name: 'จุดตรวจหน้า รพ.ยะลา',
    lat: 6.541234,
    lon: 101.284567,
    address: 'อ.เมืองยะลา, จ.ยะลา'
  });
  assert(custom1 !== null, 'Custom preset 1 saved');

  const custom2 = saveCustomPreset({
    id: 'my_custom_cp_2',
    name: 'ด่านตรวจคลองทรายใน',
    lat: 6.612345,
    lon: 101.213456,
    address: 'อ.เมืองยะลา, จ.ยะลา'
  });
  assert(custom2 !== null, 'Custom preset 2 saved');

  const all = getAllPresets();
  // 2 custom + 8 default = 10 presets
  assertEqual(all.length, 10, 'Must have 10 total presets (2 custom + 8 default)');
  assertEqual(all[0].id, 'my_custom_cp_2', 'Latest custom preset unshifted to front');
  assertEqual(all[1].id, 'my_custom_cp_1', 'Second custom preset next');

  // Test deduplication / update existing preset
  saveCustomPreset({
    id: 'my_custom_cp_1',
    name: 'จุดตรวจหน้า รพ.ยะลา (ปรับปรุง)',
    lat: 6.541999,
    lon: 101.284999,
    address: 'อ.เมืองยะลา, จ.ยะลา'
  });
  const allUpdated = getAllPresets();
  assertEqual(allUpdated.length, 10, 'Length remains 10 after update');
  const found = allUpdated.find(p => p.id === 'my_custom_cp_1');
  assertEqual(found.name, 'จุดตรวจหน้า รพ.ยะลา (ปรับปรุง)', 'Name updated');
  assertEqual(found.lat, 6.541999, 'Lat updated');
});

check('S5.3: Factory default presets protected from deletion', () => {
  const deleted = deleteCustomPreset('preset_yala_ref');
  assertEqual(deleted, false, 'deleteCustomPreset must refuse to delete factory preset');
  const all = getAllPresets();
  assert(all.some(p => p.id === 'preset_yala_ref'), 'preset_yala_ref must still exist');
});

check('S5.4: Custom preset deletion removes target cleanly', () => {
  const deleted = deleteCustomPreset('my_custom_cp_1');
  assertEqual(deleted, true, 'deleteCustomPreset successfully deletes custom preset');
  const customs = getCustomPresets();
  assert(!customs.some(p => p.id === 'my_custom_cp_1'), 'my_custom_cp_1 removed from list');
});

check('S5.5: QuotaExceededError fallback preserves state in memory', () => {
  const failingStorage = {
    getItem: () => null,
    setItem: () => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem: () => {}
  };
  setMockLocalStorage(failingStorage);
  clearCustomPresets();

  const saved = saveCustomPreset({
    name: 'จุดบันทึกตอนโควต้าเต็ม',
    lat: 13.75,
    lon: 100.49,
    address: 'เขตพระนคร, กรุงเทพมหานคร'
  });
  assert(saved !== null, 'Preset saved to memory fallback despite QuotaExceededError');
  const customs = getCustomPresets();
  assertEqual(customs.length, 1, 'Memory fallback retains preset');
  assertEqual(customs[0].name, 'จุดบันทึกตอนโควต้าเต็ม', 'Retains correct data in memory');
});

// =========================================================================
// SECTION 6: Application Wiring & Integration Forensics
// =========================================================================
console.log('\n--- SECTION 6: Application Wiring & Integration Forensics ---');

const indexHtmlPath = path.join(PROJECT_ROOT, 'index.html');
const appJsPath = path.join(PROJECT_ROOT, 'js', 'app.js');
const mapPickerJsPath = path.join(PROJECT_ROOT, 'js', 'map-picker.js');

const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
const appJsContent = fs.readFileSync(appJsPath, 'utf-8');
const mapPickerJsContent = fs.readFileSync(mapPickerJsPath, 'utf-8');

check('S6.1: Forensic Check — Is map-picker.js loaded or imported into the web app?', () => {
  const importedInApp = /import\s+.*['"]\.\/map-picker(\.js)?['"]/.test(appJsContent);
  const loadedInHtml = /src=['"][^'"]*map-picker\.js['"]/.test(indexHtmlContent);

  if (!importedInApp && !loadedInHtml) {
    recordFinding(
      'CRITICAL',
      'FINDING-M3-01',
      'Leaflet Map Module is NEVER loaded or imported into the Web Application',
      'js/map-picker.js is neither imported in js/app.js nor loaded via a <script> tag in index.html. ' +
      'As a direct consequence, the Leaflet map container (<div id="map">) is completely empty and uninitialized ' +
      'in live browsers. Map tiles, custom SVG DivIcon pin, dragging, and tap-to-pin interactions never run in the app!'
    );
    throw new Error('map-picker.js is completely omitted from index.html and app.js');
  }
});

check('S6.2: Forensic Check — Does app.js call initMap() on startup?', () => {
  const callsInitMap = /\binitMap\s*\(/.test(appJsContent) || /\binitMap\s*\(/.test(indexHtmlContent);
  if (!callsInitMap) {
    recordFinding(
      'CRITICAL',
      'FINDING-M3-02',
      'initMap() is NEVER invoked during application lifecycle bootstrap',
      'js/app.js exports an init() bootstrap function that initializes fonts, state subscriptions, ' +
      'DOM listeners, presets, and clock, but NEVER invokes initMap("map", ...). The map is never created.'
    );
    throw new Error('initMap() is never called in app.js or index.html');
  }
});

check('S6.3: Forensic Check — Are window.setMapCoordinates and window.panMapTo phantom calls?', () => {
  const definesSetCoords = /window\.setMapCoordinates\s*=/.test(appJsContent) ||
                           /window\.setMapCoordinates\s*=/.test(mapPickerJsContent) ||
                           /window\.setMapCoordinates\s*=/.test(indexHtmlContent);

  const definesPanTo = /window\.panMapTo\s*=/.test(appJsContent) ||
                       /window\.panMapTo\s*=/.test(mapPickerJsContent) ||
                       /window\.panMapTo\s*=/.test(indexHtmlContent);

  if (!definesSetCoords || !definesPanTo) {
    recordFinding(
      'HIGH',
      'FINDING-M3-03',
      'Phantom window.setMapCoordinates and window.panMapTo calls in app.js',
      'app.js attempts to call window.setMapCoordinates(state.lat, state.lon) and window.panMapTo(lat, lon), ' +
      'but neither function is ever assigned to the window global object anywhere in the codebase. ' +
      'External coordinate changes fail to pan or synchronize the map marker in the browser.'
    );
    throw new Error('window.setMapCoordinates and/or window.panMapTo are never defined');
  }
});

check('S6.4: Forensic Check — Does #viewfinder-placeholder permanently block the canvas?', () => {
  const placeholderInHtml = indexHtmlContent.includes('id="viewfinder-placeholder"');
  const placeholderDismissedInApp = appJsContent.includes('viewfinder-placeholder');

  if (placeholderInHtml && !placeholderDismissedInApp) {
    recordFinding(
      'CRITICAL',
      'FINDING-M3-04',
      'Empty State #viewfinder-placeholder overlay permanently covers and obscures preview canvas',
      'index.html defines <div id="viewfinder-placeholder"> with CSS position: absolute; inset: 0; z-index: 10; ' +
      'and opaque radial background. app.js draws to the canvas underneath, but NEVER hides or removes ' +
      '#viewfinder-placeholder when a photo is uploaded or captured. The user can never see their loaded photo!'
    );
    throw new Error('#viewfinder-placeholder is never toggled/hidden by app.js when an image is loaded');
  }
});

check('S6.5: Forensic Check — DOM Element ID mismatch on map URL input (#map-link-input vs #map-url-input)', () => {
  const htmlHasMapLinkInput = indexHtmlContent.includes('id="map-link-input"');
  const appQueriesMapLinkInput = appJsContent.includes('map-link-input');

  if (htmlHasMapLinkInput && !appQueriesMapLinkInput) {
    recordFinding(
      'HIGH',
      'FINDING-M3-05',
      'DOM ID Mismatch: index.html has #map-link-input while app.js queries #map-url-input',
      'index.html defines the Universal Map Link input with id="map-link-input" and button id="btn-parse-link". ' +
      'However, app.js queries document.getElementById("map-url-input") || document.getElementById("url-input"). ' +
      'Both return null. User paste and change events on the map link input are NEVER handled in the UI!'
    );
    throw new Error('app.js does not query #map-link-input');
  }
});

check('S6.6: Forensic Check — DOM Element ID mismatch on GPS button (#btn-quick-gps vs #locate-btn)', () => {
  const htmlHasQuickGps = indexHtmlContent.includes('id="btn-quick-gps"');
  const appQueriesQuickGps = appJsContent.includes('btn-quick-gps');

  if (htmlHasQuickGps && !appQueriesQuickGps) {
    recordFinding(
      'HIGH',
      'FINDING-M3-06',
      'DOM ID Mismatch: index.html has #btn-quick-gps while app.js queries #locate-btn',
      'index.html defines the quick GPS locate button with id="btn-quick-gps". ' +
      'app.js queries locate-btn, btn-locate, and btn-gps, but not btn-quick-gps. ' +
      'Clicking the quick GPS button in the shutter bar does nothing!'
    );
    throw new Error('app.js does not query #btn-quick-gps');
  }
});

check('S6.7: Forensic Check — Export filename overwrites standardized timestamped format', () => {
  const passesOriginalFilename = /filename:\s*state\.originalFilename/.test(appJsContent);
  if (passesOriginalFilename) {
    recordFinding(
      'MEDIUM',
      'FINDING-M3-07',
      'app.js passes state.originalFilename to exportImage, overwriting timestamp_YYYYMMDD_HHmmss.jpg',
      'In app.js line 554, exportImage is invoked with filename: state.originalFilename. ' +
      'When the user uploads "photo.jpg", export-manager uses opts.filename ("photo.jpg") instead of ' +
      'generating the standardized timestamped name "timestamp_YYYYMMDD_HHmmss.jpg" per F21/R2.'
    );
    throw new Error('app.js forces originalFilename over standardized timestamp format');
  }
});

// =========================================================================
// FINAL REPORT & VERDICT
// =========================================================================
console.log('\n===========================================================');
console.log('              ADVERSARIAL STRESS TEST SUMMARY              ');
console.log('===========================================================');
console.log(`Total Assertions Run:   ${summary.total}`);
console.log(`Assertions Passed:      ${summary.passed}`);
console.log(`Assertions Failed:      ${summary.failed}`);
console.log(`Findings Discovered:    ${summary.findings.length}`);
console.log('-----------------------------------------------------------');

if (summary.findings.length > 0) {
  console.log('\nDISCOVERED CRITICAL FINDINGS:');
  for (const f of summary.findings) {
    console.log(`\n[${f.severity}] ${f.id}: ${f.title}`);
    console.log(`  Details: ${f.details}`);
  }
}

console.log('\n-----------------------------------------------------------');
const verdict = summary.failed > 0 || summary.findings.some(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
  ? 'REQUEST_CHANGES'
  : 'APPROVE';

console.log(`>>> VERDICT: ${verdict} <<<`);
console.log('===========================================================');
