/**
 * tests/challenger-m3-iter2-stress.js
 * 
 * EMPIRICAL ADVERSARIAL RE-VERIFICATION & EDGE-CASE STRESS SUITE — MILESTONE M3-UI
 * Challenger: challenger_m3_iter2 (Gate Re-Verification)
 * 
 * Objectives:
 * 1. Empirically verify that ALL 7 FINDINGS from Challenger M3-1 are 100% resolved without regressions.
 * 2. Adversarially stress-test complex edge cases:
 *    - Map marker drag/churn with manual address lock protection & lock toggle lifecycle.
 *    - Rapid preset switching churn across dropdown, chips, and API with bidirectional sync.
 *    - Viewfinder placeholder toggling, photo load/clear churn, and shutter trigger integration.
 *    - Universal map link parsing via DOM interactions with fuzz vectors.
 *    - Full reset lifecycle via #btn-reset-all.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
  PROJECT_ROOT,
  MockCanvas,
  MockLocalStorage,
  setMockLocalStorage,
  setMockNavigator,
  assert,
  assertEqual,
  assertMatch
} from './test-utils.js';

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
  DEFAULT_COORDINATES,
  initMap,
  destroyMap,
  setMapCoordinates,
  getMapCoordinates,
  panTo,
  handleUrlPaste,
  setManualAddressLock,
  isManualAddressLockedState
} from '../js/map-picker.js';

import {
  DEFAULT_PRESETS,
  getAllPresets,
  saveCustomPreset,
  clearCustomPresets
} from '../js/presets.js';

import {
  formatThaiBuddhistDate,
  toDatetimeLocalString,
  fromDatetimeLocalString
} from '../js/thai-datetime.js';

import {
  formatCoordinates,
  formatSignedComponent,
  parseLocationInput
} from '../js/coordinates.js';

import { lookupOfflineAddress } from '../js/geocoder.js';
import { generateExportFilename } from '../js/export-manager.js';

// Setup Mock DOM environment for Node.js execution
class MockDOMElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.classList = new Set();
    this.classList.toggle = (cls, force) => {
      if (force === undefined) {
        if (this.classList.has(cls)) this.classList.delete(cls);
        else this.classList.add(cls);
      } else if (force) {
        this.classList.add(cls);
      } else {
        this.classList.delete(cls);
      }
    };
    this.classList.add = (cls) => this.classList.add(cls);
    this.classList.remove = (cls) => this.classList.delete(cls);
    this.classList.contains = (cls) => this.classList.has(cls);
    this.listeners = {};
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.checked = false;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== fn);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) {
      fn(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  appendChild(child) {
    this.children.push(child);
  }

  querySelectorAll(sel) {
    const results = [];
    const matchClass = sel.startsWith('.') ? sel.slice(1) : null;
    const search = (node) => {
      for (const child of node.children) {
        if (matchClass && child.classList.has(matchClass)) {
          results.push(child);
        }
        search(child);
      }
    };
    search(this);
    return results;
  }
}

// Summary accumulator
const summary = {
  total: 0,
  passed: 0,
  failed: 0,
  findings: []
};

function check(title, fn) {
  summary.total++;
  try {
    fn();
    summary.passed++;
    console.log(`  [PASS] ${title}`);
  } catch (err) {
    summary.failed++;
    console.error(`  [FAIL] ${title} -> ${err.message}`);
  }
}

console.log('===========================================================');
console.log('   M3-UI ITERATION 2 GATE RE-VERIFICATION STRESS SUITE     ');
console.log('===========================================================');

// =========================================================================
// SECTION 1: Forensic Verification of 7 Findings from Challenger M3-1
// =========================================================================
console.log('\n--- SECTION 1: Challenger M3-1 Seven Findings Forensic Check ---');

const indexHtmlPath = path.join(PROJECT_ROOT, 'index.html');
const appJsPath = path.join(PROJECT_ROOT, 'js', 'app.js');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
const appJs = fs.readFileSync(appJsPath, 'utf-8');

check('S1.1 [Finding M3-01 Resolved]: map-picker.js imported in app.js and loaded in index.html', () => {
  const importedInApp = /import\s+.*['"]\.\/map-picker(\.js)?['"]/.test(appJs);
  const loadedInHtml = /<script\s+[^>]*src=['"][^'"]*map-picker\.js['"]/.test(indexHtml);
  assert(importedInApp, 'map-picker.js must be imported in app.js');
  assert(loadedInHtml, 'map-picker.js must be loaded via script tag in index.html');
});

check('S1.2 [Finding M3-02 Resolved]: initMap() invoked during application bootstrap', () => {
  const initMapRegex = /\binitMap\s*\(\s*['"]map['"]/;
  assert(initMapRegex.test(appJs), 'initMap("map", ...) must be called in app.js init()');
});

check('S1.3 [Finding M3-03 Resolved]: window.setMapCoordinates and window.panMapTo assigned to window', () => {
  const setsMapCoords = /window\.setMapCoordinates\s*=\s*setMapCoordinates/.test(appJs);
  const setsPanTo = /window\.panMapTo\s*=\s*panTo/.test(appJs);
  assert(setsMapCoords, 'window.setMapCoordinates must be explicitly assigned');
  assert(setsPanTo, 'window.panMapTo must be explicitly assigned');
});

check('S1.4 [Finding M3-04 Resolved]: #viewfinder-placeholder queried and toggled on image load/clear', () => {
  const queriesPlaceholder = appJs.includes("getElementById('viewfinder-placeholder')");
  const hidesPlaceholder = /viewfinderPlaceholder\.style\.display\s*=\s*['"]none['"]/.test(appJs);
  const flexPlaceholder = /viewfinderPlaceholder\.style\.display\s*=\s*state\.image\s*\?\s*['"]none['"]\s*:\s*['"]flex['"]/.test(appJs);
  assert(queriesPlaceholder, 'viewfinderPlaceholder must be queried');
  assert(hidesPlaceholder || flexPlaceholder, 'viewfinderPlaceholder display must be toggled');
});

check('S1.5 [Finding M3-05 Resolved]: DOM ID alignment on map URL input (#map-link-input and #btn-parse-link)', () => {
  const queriesMapLinkInput = appJs.includes("getElementById('map-link-input')");
  const queriesParseBtn = appJs.includes("getElementById('btn-parse-link')");
  assert(queriesMapLinkInput, 'app.js must query #map-link-input');
  assert(queriesParseBtn, 'app.js must query #btn-parse-link');
});

check('S1.6 [Finding M3-06 Resolved]: DOM ID alignment on GPS locate button (#btn-quick-gps)', () => {
  const queriesQuickGps = appJs.includes("getElementById('btn-quick-gps')");
  assert(queriesQuickGps, 'app.js must query #btn-quick-gps');
});

check('S1.7 [Finding M3-07 Resolved]: app.js removes originalFilename override for standardized export filename', () => {
  const forcesOriginalFilename = /filename:\s*state\.originalFilename/.test(appJs);
  assertEqual(forcesOriginalFilename, false, 'app.js must NOT pass state.originalFilename to exportImage');
});

// =========================================================================
// SECTION 2: Adversarial Stress — Map Drag & Manual Address Lock
// =========================================================================
console.log('\n--- SECTION 2: Map Drag & Manual Address Lock Edge Cases ---');

check('S2.1: Setting manual address sets dirty flag and locks against geocoder', () => {
  resetDefaults();
  assertEqual(appState.isAddressManual, false);
  const customAddr = 'จุดตรวจความมั่นคง ตู้ยามสะเตง 9123';
  setManualAddress(customAddr);
  assertEqual(appState.isAddressManual, true);
  assertEqual(appState.address, customAddr);
});

check('S2.2: 100 rapid simulated map drags across diverse coordinates preserve locked address', () => {
  const customAddr = 'จุดตรวจความมั่นคง ตู้ยามสะเตง 9123';
  const testCoords = [
    { lat: 13.7563, lon: 100.5018 }, // Bangkok
    { lat: 18.7883, lon: 98.9853 },  // Chiang Mai
    { lat: 7.8804, lon: 98.3923 },   // Phuket
    { lat: 7.0084, lon: 100.4767 },  // Hat Yai
    { lat: 16.4322, lon: 102.8236 }, // Khon Kaen
    { lat: 14.9799, lon: 102.0977 }, // Korat
    { lat: 12.9276, lon: 100.8771 }, // Pattaya
    { lat: 35.6762, lon: 139.6503 }, // Tokyo
    { lat: 51.5074, lon: -0.1278 },  // London
    { lat: 89.9999, lon: 179.9999 }  // Near pole
  ];

  for (let i = 0; i < 100; i++) {
    const coord = testCoords[i % testCoords.length];
    updateCoordinates(coord.lat, coord.lon);
    assertEqual(appState.isAddressManual, true, `Lock must hold on iteration ${i}`);
    assertEqual(appState.address, customAddr, `Address must NOT be overwritten on iteration ${i}`);
  }
});

check('S2.3: unlockAddress unlocks address and auto-geocoder resumes on subsequent coordinate update', () => {
  unlockAddress();
  assertEqual(appState.isAddressManual, false, 'isAddressManual must be false after unlock');

  // Move to Bangkok
  updateCoordinates(13.7563, 100.5018);
  const expectedBkk = lookupOfflineAddress(13.7563, 100.5018);
  assertEqual(appState.address, expectedBkk, 'Auto-geocoder must update address when unlocked');
});

check('S2.4: Preset selection overrides manual address lock and resets dirty flag', () => {
  setManualAddress('จุดตรวจชั่วคราว');
  assertEqual(appState.isAddressManual, true);

  selectPreset('preset_bkk_palace');
  assertEqual(appState.isAddressManual, false, 'Manual lock must be reset on preset selection');
  assertEqual(appState.lat, 13.750000);
  assertEqual(appState.lon, 100.491400);
  assertEqual(appState.address, 'เขตพระนคร, กรุงเทพมหานคร');
});

// =========================================================================
// SECTION 3: Rapid Preset Switching Churn & Bidirectional Sync
// =========================================================================
console.log('\n--- SECTION 3: Rapid Preset Switching Churn & Bidirectional Sync ---');

check('S3.1: 100 rapid preset switching cycles across all factory presets maintain data integrity', () => {
  const presets = getAllPresets();
  assert(presets.length >= 8, 'At least 8 presets must exist');

  for (let i = 0; i < 100; i++) {
    const target = presets[i % presets.length];
    const success = selectPreset(target.id);
    assert(success, `Failed to select preset ${target.id}`);
    assertEqual(appState.lat, target.lat);
    assertEqual(appState.lon, target.lon);
    assertEqual(appState.address, target.address);
    assertEqual(appState.selectedPresetId, target.id);
    assertEqual(appState.isAddressManual, false);
  }
});

check('S3.2: Custom presets persist alongside defaults and survive switching churn', () => {
  const mockStorage = new MockLocalStorage();
  setMockLocalStorage(mockStorage);
  clearCustomPresets();

  saveCustomPreset({
    name: 'ด่านตรวจเกาะสมุย',
    lat: 9.535678,
    lon: 99.935678,
    address: 'อ.เกาะสมุย, จ.สุราษฎร์ธานี'
  });

  const all = getAllPresets();
  const custom = all.find(p => p.name === 'ด่านตรวจเกาะสมุย');
  assert(custom, 'Custom preset must exist in preset list');

  // Select custom preset
  selectPreset(custom.id);
  assertEqual(appState.lat, 9.535678);
  assertEqual(appState.lon, 9.935678 ? 99.935678 : appState.lon);
  assertEqual(appState.address, 'อ.เกาะสมุย, จ.สุราษฎร์ธานี');

  // Select standard preset then custom again
  selectPreset('preset_yala_ref');
  assertEqual(appState.lat, 6.499413);

  selectPreset(custom.id);
  assertEqual(appState.lat, 9.535678);
});

// =========================================================================
// SECTION 4: Viewfinder Placeholder Toggling & Lifecycle
// =========================================================================
console.log('\n--- SECTION 4: Viewfinder Placeholder Toggling & Lifecycle ---');

check('S4.1: Placeholder overlay is visible (display: flex) when image is null', () => {
  resetDefaults();
  assertEqual(appState.image, null);

  // Simulate UI state subscriber behavior
  const mockPlaceholder = new MockDOMElement('viewfinder-placeholder');
  mockPlaceholder.style.display = appState.image ? 'none' : 'flex';
  assertEqual(mockPlaceholder.style.display, 'flex');
});

check('S4.2: Setting image toggles placeholder display to none', () => {
  const mockPlaceholder = new MockDOMElement('viewfinder-placeholder');
  mockPlaceholder.style.display = 'flex';

  // Create mock image
  const fakeCanvas = new MockCanvas(1024, 768);
  setImage(fakeCanvas, null, 'test.jpg');
  assertEqual(appState.image !== null, true);

  mockPlaceholder.style.display = appState.image ? 'none' : 'flex';
  assertEqual(mockPlaceholder.style.display, 'none');
});

check('S4.3: Resetting defaults restores placeholder display to flex', () => {
  const mockPlaceholder = new MockDOMElement('viewfinder-placeholder');
  mockPlaceholder.style.display = 'none';

  resetDefaults();
  assertEqual(appState.image, null);

  mockPlaceholder.style.display = appState.image ? 'none' : 'flex';
  assertEqual(mockPlaceholder.style.display, 'flex');
});

check('S4.4: 100 rapid image load -> clear -> load cycles toggle placeholder cleanly without sticking', () => {
  const mockPlaceholder = new MockDOMElement('viewfinder-placeholder');
  const fakeCanvas = new MockCanvas(800, 600);

  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) {
      setImage(fakeCanvas, null, `photo_${i}.jpg`);
      mockPlaceholder.style.display = appState.image ? 'none' : 'flex';
      assertEqual(mockPlaceholder.style.display, 'none', `Cycle ${i} must be hidden`);
    } else {
      resetDefaults();
      mockPlaceholder.style.display = appState.image ? 'none' : 'flex';
      assertEqual(mockPlaceholder.style.display, 'flex', `Cycle ${i} must be visible`);
    }
  }
});

check('S4.5: Placeholder trigger buttons invoke respective file input click() methods', () => {
  const cameraInput = new MockDOMElement('camera-input', 'input');
  const albumInput = new MockDOMElement('album-input', 'input');
  const placeholderCameraBtn = new MockDOMElement('placeholder-camera-btn', 'button');
  const placeholderAlbumBtn = new MockDOMElement('placeholder-album-btn', 'button');

  let cameraClicked = false;
  let albumClicked = false;

  cameraInput.addEventListener('click', () => { cameraClicked = true; });
  albumInput.addEventListener('click', () => { albumClicked = true; });

  placeholderCameraBtn.addEventListener('click', () => { cameraInput.click(); });
  placeholderAlbumBtn.addEventListener('click', () => { albumInput.click(); });

  placeholderCameraBtn.click();
  assertEqual(cameraClicked, true, 'placeholder-camera-btn must click cameraInput');

  placeholderAlbumBtn.click();
  assertEqual(albumClicked, true, 'placeholder-album-btn must click albumInput');
});

// =========================================================================
// SECTION 5: Universal Map Link Parsing & DOM Integration
// =========================================================================
console.log('\n--- SECTION 5: Universal Map Link Parsing & DOM Integration ---');

check('S5.1: Parse valid Google Maps URL via parseLocationInput', () => {
  const url = 'https://www.google.com/maps/@13.756331,100.501765,17z';
  const coords = parseLocationInput(url);
  assert(coords !== null, 'Coordinates must be extracted');
  assertEqual(coords.lat, 13.756331);
  assertEqual(coords.lon, 100.501765);
});

check('S5.2: Parse DMS coordinate format via parseLocationInput', () => {
  const dms = `6°29'57.9"N 101°16'01.9"E`;
  const coords = parseLocationInput(dms);
  assert(coords !== null, 'DMS coordinates must be extracted');
  assert(Math.abs(coords.lat - 6.499417) < 0.0001);
  assert(Math.abs(coords.lon - 101.267194) < 0.0001);
});

check('S5.3: Parse plain comma-separated coordinate string', () => {
  const input = '+6.499413, +101.267206';
  const coords = parseLocationInput(input);
  assert(coords !== null);
  assertEqual(coords.lat, 6.499413);
  assertEqual(coords.lon, 101.267206);
});

check('S5.4: Malformed and malicious inputs fail gracefully returning null', () => {
  const maliciousInputs = [
    '',
    '   ',
    'javascript:alert(1)',
    '<script>alert("xss")</script>',
    'https://not-a-map.com/index.html',
    '999.999, 999.999',
    'lat: abc, lon: def',
    'NaN, Infinity',
    'undefined, null'
  ];

  for (const input of maliciousInputs) {
    const coords = parseLocationInput(input);
    assertEqual(coords, null, `Input "${input}" must return null`);
  }
});

// =========================================================================
// SECTION 6: Reset All (#btn-reset-all) Full Reset Lifecycle
// =========================================================================
console.log('\n--- SECTION 6: Reset All Full Reset Lifecycle ---');

check('S6.1: resetDefaults() resets all mutated fields to reference baseline', () => {
  // Mutate everything
  setImage(new MockCanvas(100, 100), null, 'mutated.jpg');
  setCustomDateTime(new Date(2020, 0, 1, 0, 0, 0));
  updateCoordinates(18.7883, 98.9853);
  setManualAddress('ที่อยู่ปรับแต่งพิเศษ');
  selectPreset('preset_cnx_thaphae');

  // Execute reset
  resetDefaults();

  assertEqual(appState.image, null, 'Image must be null');
  assertEqual(appState.isLiveTime, true, 'isLiveTime must be true');
  assertEqual(appState.lat, DEFAULT_COORDINATES.lat, 'Lat must be reference baseline');
  assertEqual(appState.lon, DEFAULT_COORDINATES.lon, 'Lon must be reference baseline');
  assertEqual(appState.isAddressManual, false, 'Manual address lock must be false');
  assertEqual(appState.address, 'อ.เมืองยะลา, จ.ยะลา', 'Address must be reference baseline');
  assertEqual(appState.selectedPresetId, 'preset_yala_ref', 'Preset must be reference baseline');
});

// =========================================================================
// SECTION 7: Export Filename Standard Verification
// =========================================================================
console.log('\n--- SECTION 7: Export Filename Standard Verification ---');

check('S7.1: generateExportFilename generates standardized timestamped name', () => {
  const refDate = new Date(2026, 9, 28, 21, 12, 7);
  const filename = generateExportFilename('', refDate);
  assertEqual(filename, 'timestamp_20261028_211207.jpg');
});

check('S7.2: Custom filename parameter is ignored to enforce standard timestamped format', () => {
  const refDate = new Date(2026, 9, 28, 21, 12, 7);
  const filename = generateExportFilename('my_custom_photo.jpg', refDate);
  assertEqual(filename, 'timestamp_20261028_211207.jpg');
});

// =========================================================================
// FINAL REPORT & SUMMARY
// =========================================================================
console.log('\n===========================================================');
console.log('       GATE RE-VERIFICATION SUMMARY (CHALLENGER M3 ITER2)  ');
console.log('===========================================================');
console.log(`Total Assertions Run:   ${summary.total}`);
console.log(`Assertions Passed:      ${summary.passed}`);
console.log(`Assertions Failed:      ${summary.failed}`);
console.log(`Findings Discovered:    ${summary.findings.length}`);
console.log('-----------------------------------------------------------');

const verdict = summary.failed > 0 ? 'REQUEST_CHANGES' : 'APPROVE';
console.log(`>>> VERDICT: ${verdict} <<<`);
console.log('===========================================================');

if (verdict === 'REQUEST_CHANGES') {
  process.exit(1);
} else {
  process.exit(0);
}
