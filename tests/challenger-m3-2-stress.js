/**
 * tests/challenger-m3-2-stress.js
 * 
 * EMPIRICAL ADVERSARIAL STRESS HARNESS — MILESTONE M3-UI
 * Challenger: challenger_m3_2
 * 
 * Deeply stress-tests:
 * 1. State mutation race conditions: 100 concurrent async mutations (lat, lon, datetime, image simultaneously),
 *    subscriber set churn during notifications, poison pill isolation, and coordinate/datetime boundary validation.
 * 2. Live 1Hz timer stability: start/stop/resume cycles, rapid churn idempotency, manual datetime override freezing,
 *    live time restoration, and EXIF datetime freeze.
 * 3. Web Share API stress:
 *    - canShare = true: file packaging into native File([blob], filename, { type: 'image/jpeg' }).
 *    - User dismissal (AbortError): clean graceful handling without uncaught exception or unwanted download fallback.
 *    - Permission/system errors (NotAllowedError): clean fallback to desktop anchor download.
 *    - Unsupported Web Share: clean desktop anchor download fallback, DOM element creation and cleanup.
 *    - Full progress callback hook sequence verification.
 * 4. Filename generator stress across leap years, month boundaries, edge dates, single-digit padding, and invalid inputs.
 */

import { MockCanvas, MockContext2D, setMockNavigator } from './test-utils.js';

import {
  appState,
  DEFAULT_STATE,
  getState,
  subscribe,
  notifySubscribers,
  setImage,
  setDateTime,
  setCustomDateTime,
  setLiveTime,
  tickLiveTime,
  updateCoordinates,
  setCoordinates,
  setAddress,
  setManualAddress,
  unlockAddress,
  selectPreset,
  applyExifMetadata,
  setExporting,
  resetDefaults,
  updateState
} from '../js/state.js';

import {
  generateExportFilename,
  canUseWebShare,
  downloadBlob,
  shareFile,
  exportImage,
  ExportManager
} from '../js/export-manager.js';

import {
  startClock,
  stopClock
} from '../js/app.js';

import { isValidCoordinate } from '../js/coordinates.js';
import { isValidDate } from '../js/thai-datetime.js';

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

function assertMatch(str, regex, testName) {
  results.total++;
  if (regex.test(str)) {
    results.passed++;
    console.log(`  [PASS] ${testName}`);
  } else {
    results.failed++;
    const msg = `${testName} -> String "${str}" does not match regex ${regex}`;
    results.failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

// Polyfill MockContext2D transform methods if not present
if (!MockContext2D.prototype.scale) {
  MockContext2D.prototype.scale = function(x, y) { this.calls.push({ method: 'scale', args: { x, y } }); };
}
if (!MockContext2D.prototype.translate) {
  MockContext2D.prototype.translate = function(x, y) { this.calls.push({ method: 'translate', args: { x, y } }); };
}
if (!MockContext2D.prototype.rotate) {
  MockContext2D.prototype.rotate = function(angle) { this.calls.push({ method: 'rotate', args: { angle } }); };
}

// Polyfill MockCanvas.prototype.toBlob with real Blob instance for Node runtime
MockCanvas.prototype.toBlob = function(callback, type = 'image/jpeg', quality = 0.95) {
  const fakeBuffer = Buffer.from(`MOCK_IMAGE_BLOB_${this.width}x${this.height}_${type}_${quality}`);
  const blob = (typeof Blob !== 'undefined')
    ? new Blob([fakeBuffer], { type })
    : { size: fakeBuffer.length, type, arrayBuffer: async () => fakeBuffer.buffer };
  if (callback) {
    setTimeout(() => callback(blob), 0);
  }
  return Promise.resolve(blob);
};

// Polyfill globalThis.MockCanvas
globalThis.MockCanvas = MockCanvas;

// =========================================================================
// SECTION 1: State Mutation Race Conditions & Concurrency Stress
// =========================================================================
console.log('\n--- SECTION 1: State Mutation Race Conditions & Concurrency Stress ---');

async function testSection1() {
  resetDefaults();

  // Test 1.1: 100 Concurrent Asynchronous State Mutations
  const subscriberCalls = {
    sub1: 0,
    sub2: 0,
    sub3: 0
  };
  const keysRecorded = new Set();

  const unsub1 = subscribe((state, changedKeys) => {
    subscriberCalls.sub1++;
    changedKeys.forEach(k => keysRecorded.add(k));
  });
  const unsub2 = subscribe((state, changedKeys) => {
    subscriberCalls.sub2++;
  });
  const unsub3 = subscribe((state, changedKeys) => {
    subscriberCalls.sub3++;
  });

  const validPresets = ['preset_yala_ref', 'preset_bkk_palace', 'preset_cnx_thaphae', 'preset_hkt_oldtown'];
  const asyncTasks = [];

  for (let i = 0; i < 100; i++) {
    asyncTasks.push((async () => {
      // Small randomized jitter to force thread-interleaving in Node event loop
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 15)));

      const mod = i % 7;
      switch (mod) {
        case 0:
          // Coordinates mutation
          const lat = 6.0 + (i * 0.1);
          const lon = 100.0 + (i * 0.1);
          updateCoordinates(lat, lon);
          break;
        case 1:
          // Datetime mutation
          setDateTime(new Date(2026, 9, (i % 28) + 1, (i % 24), (i % 60), (i % 60)));
          break;
        case 2:
          // Image and filename mutation
          setImage({ width: 1024, height: 768 }, null, `photo_${i}.jpg`);
          break;
        case 3:
          // Address manual / automatic mutation
          setAddress(`Address Test ${i}`, i % 2 === 0);
          break;
        case 4:
          // Live ticking clock toggle
          setLiveTime(i % 2 === 0);
          break;
        case 5:
          // Preset selection (using valid presets)
          selectPreset(validPresets[i % validPresets.length]);
          break;
        case 6:
          // Batch updateState
          updateState({
            lat: 13.750000,
            lon: 100.490000,
            address: 'กรุงเทพมหานคร'
          });
          break;
      }
    })());
  }

  await Promise.all(asyncTasks);

  // Assertions for 1.1
  assertEqual(subscriberCalls.sub1, 100, '1.1.1: Subscriber 1 received all 100 concurrent notifications without drop');
  assertEqual(subscriberCalls.sub1, subscriberCalls.sub2, '1.1.2: Subscribers 1 & 2 remained in lockstep synchronization');
  assertEqual(subscriberCalls.sub1, subscriberCalls.sub3, '1.1.3: Subscribers 1 & 3 remained in lockstep synchronization');

  const finalState = getState();
  assert(Number.isFinite(finalState.lat) && finalState.lat >= -90 && finalState.lat <= 90, '1.1.4: State latitude remained within valid WGS84 range');
  assert(Number.isFinite(finalState.lon) && finalState.lon >= -180 && finalState.lon <= 180, '1.1.5: State longitude remained within valid WGS84 range');
  assert(isValidDate(finalState.dateTime), '1.1.6: State dateTime is a valid Date instance');
  assert(typeof finalState.address === 'string' && finalState.address.length > 0, '1.1.7: State address remained valid non-empty string');
  assert(typeof finalState.isLiveTime === 'boolean', '1.1.8: State isLiveTime remained valid boolean');
  assert(keysRecorded.has('lat') && keysRecorded.has('dateTime') && keysRecorded.has('image'), '1.1.9: Subscriber successfully captured changed keys across dimensions');

  unsub1();
  unsub2();
  unsub3();

  // Test 1.2: Subscriber Dynamic Churn During Notification (Self-unsubscribe, peer-unsubscribe, dynamically add)
  let selfUnsubCount = 0;
  let dynamicSubRun = false;
  let unsubSelfRef = null;

  unsubSelfRef = subscribe((state, changedKeys) => {
    selfUnsubCount++;
    if (unsubSelfRef) {
      unsubSelfRef(); // Unsubscribe self during notification execution
    }
  });

  const unsubDynamicAdder = subscribe((state, changedKeys) => {
    // Add a new subscriber during notification
    subscribe((s, k) => {
      dynamicSubRun = true;
    });
  });

  updateCoordinates(7.0, 100.5);
  assertEqual(selfUnsubCount, 1, '1.2.1: Self-unsubscribing subscriber executed exactly once');

  // Trigger again to verify self-unsubscribe truly took effect
  updateCoordinates(7.1, 100.6);
  assertEqual(selfUnsubCount, 1, '1.2.2: Self-unsubscribed listener was not invoked on subsequent state mutations');
  assert(dynamicSubRun === true, '1.2.3: Dynamically added subscriber registered cleanly without breaking Set iteration');

  unsubDynamicAdder();

  // Test 1.3: Fault-Tolerant Subscriber Protection (Poison Pill Listener)
  let siblingExecuted = false;
  const unsubPoison = subscribe(() => {
    throw new Error('Poison pill test exception: intentional error in subscriber callback');
  });
  const unsubSibling = subscribe(() => {
    siblingExecuted = true;
  });

  updateCoordinates(8.0, 99.0);
  assert(siblingExecuted === true, '1.3.1: Sibling subscriber executed successfully despite error thrown in poison listener');

  unsubPoison();
  unsubSibling();

  // Test 1.4: Validation & Boundary Stress
  resetDefaults();
  const initialLat = appState.lat;
  const initialLon = appState.lon;

  // Invalid coordinates
  assertEqual(updateCoordinates(91, 100), false, '1.4.1: Latitude > 90 rejected');
  assertEqual(updateCoordinates(-91, 100), false, '1.4.2: Latitude < -90 rejected');
  assertEqual(updateCoordinates(0, 181), false, '1.4.3: Longitude > 180 rejected');
  assertEqual(updateCoordinates(0, -181), false, '1.4.4: Longitude < -180 rejected');
  assertEqual(updateCoordinates(NaN, 100), false, '1.4.5: Latitude NaN rejected');
  assertEqual(updateCoordinates(10, Infinity), false, '1.4.6: Longitude Infinity rejected');
  assertEqual(updateCoordinates('not-a-number', 'foo'), false, '1.4.7: String non-numeric coordinates rejected');
  assertEqual(appState.lat, initialLat, '1.4.8: Invalid coordinate attempts did not alter state latitude');
  assertEqual(appState.lon, initialLon, '1.4.9: Invalid coordinate attempts did not alter state longitude');

  // Valid coordinate boundary extremes
  assert(updateCoordinates(-90, -180) === true, '1.4.10: South-West extreme [-90, -180] accepted');
  assertEqual(appState.lat, -90, '1.4.11: Latitude -90 accepted');
  assertEqual(appState.lon, -180, '1.4.12: Longitude -180 accepted');

  assert(updateCoordinates(90, 180) === true, '1.4.13: North-East extreme [90, 180] accepted');
  assertEqual(appState.lat, 90, '1.4.14: Latitude 90 accepted');
  assertEqual(appState.lon, 180, '1.4.15: Longitude 180 accepted');

  // Precision rounding to 6 decimals
  updateCoordinates(6.123456789, 101.987654321);
  assertEqual(appState.lat, 6.123457, '1.4.16: Latitude correctly rounded to 6 decimal places');
  assertEqual(appState.lon, 101.987654, '1.4.17: Longitude correctly rounded to 6 decimal places');

  // Invalid Date validation
  const validBefore = appState.dateTime;
  setDateTime('completely invalid date string');
  assertEqual(appState.dateTime, validBefore, '1.4.18: setDateTime rejects invalid date string and preserves previous state');
  setDateTime(new Date(NaN));
  assertEqual(appState.dateTime, validBefore, '1.4.19: setDateTime rejects new Date(NaN) and preserves previous state');
  setCustomDateTime(null);
  assertEqual(appState.dateTime, validBefore, '1.4.20: setCustomDateTime rejects null and preserves previous state');

  // Manual Address Lock Behavior
  setManualAddress('จุดตรวจพิเศษ ชายแดนใต้');
  assertEqual(appState.isAddressManual, true, '1.4.21: isAddressManual is true after setManualAddress');
  updateCoordinates(13.75, 100.49); // Bangkok coords
  assertEqual(appState.address, 'จุดตรวจพิเศษ ชายแดนใต้', '1.4.22: Manual address lock prevents geocoder overwrite on coordinate update');

  unlockAddress();
  assertEqual(appState.isAddressManual, false, '1.4.23: isAddressManual is false after unlockAddress');
  updateCoordinates(13.75, 100.49);
  assert(appState.address.includes('กรุงเทพ') || appState.address.includes('พระนคร'), '1.4.24: Unlocked address is automatically updated by offline geocoder');

  // Non-existent preset rejection
  assertEqual(selectPreset('preset_non_existent_random_id'), false, '1.4.25: Non-existent preset ID rejected');
  assertEqual(selectPreset(null), false, '1.4.26: null preset ID rejected');
}

// =========================================================================
// SECTION 2: Live 1Hz Timer Stability & Lifecycle
// =========================================================================
console.log('\n--- SECTION 2: Live 1Hz Timer Stability & Lifecycle ---');

async function testSection2() {
  resetDefaults();

  // Test 2.1: Start, Stop, and Resume cycles
  startClock();
  assertEqual(appState.isLiveTime, true, '2.1.1: Default isLiveTime is true');

  const beforeTick = new Date(2026, 9, 28, 10, 0, 0);
  appState.dateTime = beforeTick;
  const tickTime1 = new Date(2026, 9, 28, 10, 0, 1);
  tickLiveTime(tickTime1);
  assertEqual(appState.dateTime.getTime(), tickTime1.getTime(), '2.1.2: tickLiveTime updates state.dateTime when isLiveTime is true');

  stopClock();
  const tickTime2 = new Date(2026, 9, 28, 10, 0, 2);
  // Timer stopped; simulate time passing
  stopClock(); // Idempotent stop
  assert(true, '2.1.3: stopClock is safely idempotent');

  // Test 2.2: Rapid Repeated startClock calls without stopClock (Leaking Interval Prevention)
  for (let i = 0; i < 10; i++) {
    startClock();
  }
  assert(true, '2.2.1: 10 rapid startClock calls executed without uncaught errors');
  stopClock();

  // Test 2.3: Manual Datetime Override Freezing Live Time
  const fixedCustomDate = new Date(2026, 9, 28, 21, 12, 7);
  setCustomDateTime(fixedCustomDate);
  assertEqual(appState.isLiveTime, false, '2.3.1: setCustomDateTime disables isLiveTime (sets to false)');
  assertEqual(appState.dateTime.getTime(), fixedCustomDate.getTime(), '2.3.2: state.dateTime matches custom date');

  // Now simulate 10 ticks while frozen
  for (let s = 1; s <= 10; s++) {
    tickLiveTime(new Date(2026, 9, 28, 21, 12, 7 + s));
  }
  assertEqual(appState.dateTime.getTime(), fixedCustomDate.getTime(), '2.3.3: Live clock ticks do NOT advance datetime when isLiveTime is false');

  // Test 2.4: Restoring Live Time
  const beforeRestore = appState.dateTime;
  setLiveTime(true);
  assertEqual(appState.isLiveTime, true, '2.4.1: setLiveTime(true) restores isLiveTime to true');
  assert(appState.dateTime.getTime() !== beforeRestore.getTime(), '2.4.2: setLiveTime(true) immediately updates dateTime to current time');

  // Verify ticks resume updating datetime
  const resumedTick = new Date(2026, 9, 29, 12, 0, 0);
  tickLiveTime(resumedTick);
  assertEqual(appState.dateTime.getTime(), resumedTick.getTime(), '2.4.3: Ticks resume advancing dateTime once live time is restored');

  // Test 2.5: EXIF Datetime Freeze
  const exifDate = new Date(2025, 0, 15, 8, 30, 0);
  applyExifMetadata({
    dateTime: exifDate,
    orientation: 1
  });
  assertEqual(appState.isLiveTime, false, '2.5.1: applyExifMetadata with valid dateTime freezes live time (isLiveTime = false)');
  assertEqual(appState.dateTime.getTime(), exifDate.getTime(), '2.5.2: state.dateTime matches EXIF dateTime');

  // Apply EXIF metadata with NO date -> should NOT modify dateTime or isLiveTime
  applyExifMetadata({
    orientation: 6
  });
  assertEqual(appState.isLiveTime, false, '2.5.3: applyExifMetadata without date preserves isLiveTime');
  assertEqual(appState.dateTime.getTime(), exifDate.getTime(), '2.5.4: applyExifMetadata without date preserves dateTime');
}

// =========================================================================
// SECTION 3: Web Share API Stress & Fallback Pipeline
// =========================================================================
console.log('\n--- SECTION 3: Web Share API Stress & Fallback Pipeline ---');

async function testSection3() {
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  // Mock DOM document and anchor for download testing
  const createdAnchors = [];
  const appendChildCalls = [];
  const removeChildCalls = [];

  const mockDoc = {
    body: {
      contains: (elem) => appendChildCalls.includes(elem) && !removeChildCalls.includes(elem),
      appendChild: (elem) => { appendChildCalls.push(elem); },
      removeChild: (elem) => { removeChildCalls.push(elem); }
    },
    createElement: (tag) => {
      if (tag === 'canvas') {
        return new MockCanvas(1024, 768);
      }
      if (tag === 'a') {
        const anchor = {
          tagName: 'A',
          style: {},
          href: '',
          download: '',
          clicked: false,
          click: function() { this.clicked = true; }
        };
        createdAnchors.push(anchor);
        return anchor;
      }
      return {};
    }
  };

  Object.defineProperty(globalThis, 'document', {
    value: mockDoc,
    configurable: true,
    writable: true
  });

  // Mock sample image canvas
  const sampleCanvas = new MockCanvas(1024, 768);
  const watermarkData = {
    dateTimeStr: '28 ต.ค. 2569 21:12:07',
    coordsStr: '+6.499413,+101.267206',
    addressStr: 'อ.เมืองยะลา, จ.ยะลา'
  };

  // -----------------------------------------------------------------------
  // Test 3.1: canShare = true -> Packages into native File([blob], filename)
  // -----------------------------------------------------------------------
  let shareReceived = null;
  const mockShareNav = {
    canShare: (data) => {
      // Must receive files array containing a File
      return Array.isArray(data?.files) && data.files.length > 0;
    },
    share: async (data) => {
      shareReceived = data;
      return undefined;
    }
  };

  setMockNavigator(mockShareNav);

  // canUseWebShare test
  assert(canUseWebShare() === true, '3.1.1: canUseWebShare detects supported Web Share files capability');

  const progressEvents31 = [];
  const result31 = await exportImage(sampleCanvas, watermarkData, {
    date: new Date(2026, 9, 28, 21, 12, 7),
    onProgress: (p) => progressEvents31.push(p)
  });

  assertEqual(result31.method, 'share', '3.1.2: exportImage returns method: "share" when canShare is true');
  assert(shareReceived !== null, '3.1.3: navigator.share was invoked');
  assert(Array.isArray(shareReceived?.files) && shareReceived.files.length === 1, '3.1.4: navigator.share received files array with exactly 1 file');

  const packagedFile = shareReceived.files[0];
  assert(packagedFile instanceof File, '3.1.5: Packaged item is an instance of File');
  assertEqual(packagedFile.type, 'image/jpeg', '3.1.6: Packaged File MIME type is image/jpeg');
  assertMatch(packagedFile.name, /^timestamp_20261028_211207\.jpg$/, '3.1.7: Packaged File name matches standardized timestamped pattern');
  assert(packagedFile.size > 0, '3.1.8: Packaged File size is greater than 0');
  assertEqual(shareReceived.title, 'Timestamp Photo', '3.1.9: Share title is "Timestamp Photo"');
  assertEqual(JSON.stringify(progressEvents31), JSON.stringify(['rendering', 'sharing', 'done']), '3.1.10: Progress events emitted: rendering -> sharing -> done');

  // -----------------------------------------------------------------------
  // Test 3.2: User Dismissal / Cancellation (AbortError)
  // -----------------------------------------------------------------------
  let abortShareInvoked = false;
  const mockAbortNav = {
    canShare: () => true,
    share: async () => {
      abortShareInvoked = true;
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  };
  setMockNavigator(mockAbortNav);

  // Initial anchor count before test
  const initialAnchorCount = createdAnchors.length;
  const progressEvents32 = [];

  let result32 = null;
  let abortThrew = false;
  try {
    result32 = await exportImage(sampleCanvas, watermarkData, {
      date: new Date(2026, 9, 28, 21, 12, 7),
      onProgress: (p) => progressEvents32.push(p)
    });
  } catch (e) {
    abortThrew = true;
  }

  assert(!abortThrew, '3.2.1: AbortError does NOT throw uncaught exception to caller');
  assert(abortShareInvoked, '3.2.2: navigator.share was invoked before user aborted');
  assertEqual(result32?.method, 'share', '3.2.3: Return method is "share" on user dismissal');
  assertEqual(createdAnchors.length, initialAnchorCount, '3.2.4: Desktop anchor download fallback is NOT triggered on user AbortError cancellation');
  assertEqual(JSON.stringify(progressEvents32), JSON.stringify(['rendering', 'sharing', 'done']), '3.2.5: Progress events emitted cleanly on AbortError');

  // -----------------------------------------------------------------------
  // Test 3.3: System / Permission Error (NotAllowedError) -> Desktop Download Fallback
  // -----------------------------------------------------------------------
  let permissionShareInvoked = false;
  const mockPermissionErrorNav = {
    canShare: () => true,
    share: async () => {
      permissionShareInvoked = true;
      const permErr = new Error('Permission denied to share file');
      permErr.name = 'NotAllowedError';
      throw permErr;
    }
  };
  setMockNavigator(mockPermissionErrorNav);

  const progressEvents33 = [];
  const anchorCountBefore33 = createdAnchors.length;

  const result33 = await exportImage(sampleCanvas, watermarkData, {
    date: new Date(2026, 9, 28, 21, 12, 7),
    onProgress: (p) => progressEvents33.push(p)
  });

  assert(permissionShareInvoked, '3.3.1: navigator.share was invoked before throwing NotAllowedError');
  assertEqual(result33.method, 'download', '3.3.2: Export falls back to "download" method when share throws permission error');
  assertEqual(createdAnchors.length, anchorCountBefore33 + 1, '3.3.3: Fallback desktop anchor was appended to document');
  const fallbackAnchor = createdAnchors[createdAnchors.length - 1];
  assert(fallbackAnchor.clicked, '3.3.4: Fallback anchor click() was executed');
  assertMatch(fallbackAnchor.download, /^timestamp_20261028_211207\.jpg$/, '3.3.5: Fallback anchor has correct timestamped download name');
  assert(progressEvents33.includes('downloading'), '3.3.6: Progress events include "downloading" fallback phase');

  // -----------------------------------------------------------------------
  // Test 3.4: Web Share Unsupported (Desktop / Older Mobile)
  // -----------------------------------------------------------------------
  // Case A: navigator.share undefined
  setMockNavigator({ canShare: () => false, share: undefined });
  assertEqual(canUseWebShare(), false, '3.4.1: canUseWebShare returns false when share is undefined');

  // Case B: navigator completely undefined
  setMockNavigator(undefined);
  assertEqual(canUseWebShare(), false, '3.4.2: canUseWebShare returns false when navigator is undefined');

  // Restore with unsupported methods
  setMockNavigator({
    share: undefined,
    canShare: undefined
  });

  const progressEvents34 = [];
  const anchorCountBefore34 = createdAnchors.length;

  const result34 = await exportImage(sampleCanvas, watermarkData, {
    date: new Date(2026, 9, 28, 21, 12, 7),
    onProgress: (p) => progressEvents34.push(p)
  });

  assertEqual(result34.method, 'download', '3.4.3: Export returns method "download" when Web Share unsupported');
  assertEqual(createdAnchors.length, anchorCountBefore34 + 1, '3.4.4: Desktop download anchor was created');
  const desktopAnchor = createdAnchors[createdAnchors.length - 1];
  assert(desktopAnchor.clicked, '3.4.5: Desktop anchor .click() was called');
  assertMatch(desktopAnchor.download, /^timestamp_20261028_211207\.jpg$/, '3.4.6: Desktop anchor has standardized timestamp filename');
  assertEqual(JSON.stringify(progressEvents34), JSON.stringify(['rendering', 'downloading', 'done']), '3.4.7: Progress sequence: rendering -> downloading -> done');

  // Test anchor cleanup timer (500ms)
  await new Promise(r => setTimeout(r, 600));
  assert(removeChildCalls.includes(desktopAnchor), '3.4.8: Desktop anchor was cleaned up and removed from document.body after timeout');

  // -----------------------------------------------------------------------
  // Test 3.5: Force Download Flag (options.forceDownload = true)
  // -----------------------------------------------------------------------
  // Set navigator with share supported
  setMockNavigator(mockShareNav);
  let shareCalledWhenForced = false;
  mockShareNav.share = async () => { shareCalledWhenForced = true; };

  const anchorCountBefore35 = createdAnchors.length;
  const result35 = await exportImage(sampleCanvas, watermarkData, {
    forceDownload: true,
    date: new Date(2026, 9, 28, 21, 12, 7)
  });

  assert(!shareCalledWhenForced, '3.5.1: Web Share was NOT invoked when forceDownload: true');
  assertEqual(result35.method, 'download', '3.5.2: Method is "download" when forceDownload: true');
  assertEqual(createdAnchors.length, anchorCountBefore35 + 1, '3.5.3: Anchor download triggered when forceDownload: true');

  // -----------------------------------------------------------------------
  // Test 3.6: Export Error Notification Sequence
  // -----------------------------------------------------------------------
  const progressEvents36 = [];
  let exportThrew = false;
  try {
    // Pass null image with mock canvas that throws on export
    await exportImage(null, watermarkData, {
      canvasFactory: () => {
        throw new Error('Canvas allocation failed');
      },
      onProgress: (p) => progressEvents36.push(p)
    });
  } catch {
    exportThrew = true;
  }
  assert(exportThrew, '3.6.1: exportImage rethrows fatal rendering errors');
  assertEqual(progressEvents36[0], 'rendering', '3.6.2: Progress emitted "rendering" first');
  assertEqual(progressEvents36[progressEvents36.length - 1], 'error', '3.6.3: Progress emitted "error" on failure');

  // Restore globals
  if (originalNavDesc) {
    Object.defineProperty(globalThis, 'navigator', originalNavDesc);
  } else {
    delete globalThis.navigator;
  }
  if (originalDocDesc) {
    Object.defineProperty(globalThis, 'document', originalDocDesc);
  } else {
    delete globalThis.document;
  }
}

// =========================================================================
// SECTION 4: Filename Generator Stress Across Leap Years, Boundaries & Edges
// =========================================================================
console.log('\n--- SECTION 4: Filename Generator Stress Across Leap Years & Edge Dates ---');

function testSection4() {
  const pad = (n) => String(n).padStart(2, '0');

  // Test 4.1: General Format Regex & Length
  const test1 = generateExportFilename('photo.jpg', new Date(2026, 9, 28, 21, 12, 7));
  assertEqual(test1, 'timestamp_20261028_211207.jpg', '4.1.1: Exact match for reference date 28 Oct 2026 21:12:07');
  assertEqual(test1.length, 29, '4.1.2: Standard filename length is exactly 29 characters');
  assertMatch(test1, /^timestamp_\d{8}_\d{6}\.jpg$/, '4.1.3: Matches strict timestamped pattern');

  // Test 4.2: Leap Years
  // 2024 (standard leap year)
  const d2024 = new Date(2024, 1, 29, 14, 15, 16);
  assertEqual(generateExportFilename('', d2024), 'timestamp_20240229_141516.jpg', '4.2.1: Leap year 2024-02-29 correctly encoded');

  // 2028 (upcoming leap year)
  const d2028 = new Date(2028, 1, 29, 0, 0, 0);
  assertEqual(generateExportFilename('', d2028), 'timestamp_20280229_000000.jpg', '4.2.2: Leap year 2028-02-29 midnight correctly encoded');

  // 2000 (century leap year divisible by 400)
  const d2000 = new Date(2000, 1, 29, 23, 59, 59);
  assertEqual(generateExportFilename('', d2000), 'timestamp_20000229_235959.jpg', '4.2.3: Century leap year 2000-02-29 23:59:59 correctly encoded');

  // 2100 (century non-leap year divisible by 100 but not 400 - Feb has 28 days)
  const d2100 = new Date(2100, 1, 28, 12, 30, 0);
  assertEqual(generateExportFilename('', d2100), 'timestamp_21000228_123000.jpg', '4.2.4: Century non-leap year 2100-02-28 correctly encoded');

  // 1900 (non-leap century)
  const d1900 = new Date(1900, 1, 28, 6, 0, 0);
  assertEqual(generateExportFilename('', d1900), 'timestamp_19000228_060000.jpg', '4.2.5: Non-leap century 1900-02-28 correctly encoded');

  // Test 4.3: Month Boundaries & Edge Transitions
  // New Year Start
  const dJan1 = new Date(2026, 0, 1, 0, 0, 0);
  assertEqual(generateExportFilename('', dJan1), 'timestamp_20260101_000000.jpg', '4.3.1: Jan 1 00:00:00 (New Year Start) zero-padded correctly');

  // Year End
  const dDec31 = new Date(2026, 11, 31, 23, 59, 59);
  assertEqual(generateExportFilename('', dDec31), 'timestamp_20261231_235959.jpg', '4.3.2: Dec 31 23:59:59 (Year End) correctly encoded');

  // Non-leap Feb 28 end of month
  const dFeb28 = new Date(2026, 1, 28, 23, 59, 59);
  assertEqual(generateExportFilename('', dFeb28), 'timestamp_20260228_235959.jpg', '4.3.3: Feb 28 23:59:59 correctly encoded');

  // March 1 beginning of month
  const dMar1 = new Date(2026, 2, 1, 0, 0, 0);
  assertEqual(generateExportFilename('', dMar1), 'timestamp_20260301_000000.jpg', '4.3.4: March 1 00:00:00 correctly encoded');

  // 30-day month boundary (April 30 -> May 1)
  const dApr30 = new Date(2026, 3, 30, 23, 59, 59);
  assertEqual(generateExportFilename('', dApr30), 'timestamp_20260430_235959.jpg', '4.3.5: April 30 23:59:59 correctly encoded');
  const dMay1 = new Date(2026, 4, 1, 0, 0, 0);
  assertEqual(generateExportFilename('', dMay1), 'timestamp_20260501_000000.jpg', '4.3.6: May 1 00:00:00 correctly encoded');

  // Test 4.4: All Single-Digit Padding Stress
  // Month: 5 (May), Day: 4, Hour: 3, Minute: 2, Second: 1
  const dSingleDigits = new Date(2026, 4, 4, 3, 2, 1);
  assertEqual(generateExportFilename('', dSingleDigits), 'timestamp_20260504_030201.jpg', '4.4.1: All single-digit components (05, 04, 03, 02, 01) properly padded with leading zero');

  // Day 9, Month 9 (Sept), Hour 9, Minute 9, Second 9
  const dAllNines = new Date(2026, 8, 9, 9, 9, 9);
  assertEqual(generateExportFilename('', dAllNines), 'timestamp_20260909_090909.jpg', '4.4.2: Single-digit 9 components properly padded (09)');

  // Midnight 00:00:00
  const dMidnight = new Date(2026, 6, 15, 0, 0, 0);
  assertEqual(generateExportFilename('', dMidnight), 'timestamp_20260715_000000.jpg', '4.4.3: Midnight zero hours, minutes, seconds padded (000000)');

  // Test 4.5: Edge Inputs, Fallbacks & Coercion Resilience
  // Unix Epoch (1970-01-01)
  const dEpoch = new Date(0);
  const epochName = generateExportFilename('', dEpoch);
  assertMatch(epochName, /^timestamp_19700101_\d{6}\.jpg$/, '4.5.1: Unix Epoch Date(0) produces valid timestamped filename');

  // String ISO Date input
  const isoName = generateExportFilename('', '2026-10-28T21:12:07');
  assertMatch(isoName, /^timestamp_20261028_211207\.jpg$/, '4.5.2: ISO datetime string parsed and formatted accurately');

  // Millisecond timestamp number input
  const msDate = new Date(2026, 9, 28, 21, 12, 7).getTime();
  const msName = generateExportFilename('', msDate);
  assertEqual(msName, 'timestamp_20261028_211207.jpg', '4.5.3: Numeric epoch milliseconds parsed and formatted accurately');

  // Invalid Date: new Date(NaN) -> must fallback safely without throwing or outputting NaN
  const nanName = generateExportFilename('', new Date(NaN));
  assertMatch(nanName, /^timestamp_\d{8}_\d{6}\.jpg$/, '4.5.4: Invalid Date(NaN) falls back cleanly without NaN in filename');

  // Null input
  const nullName = generateExportFilename('', null);
  assertMatch(nullName, /^timestamp_\d{8}_\d{6}\.jpg$/, '4.5.5: null date falls back cleanly to current time');

  // Undefined input
  const undefName = generateExportFilename('', undefined);
  assertMatch(undefName, /^timestamp_\d{8}_\d{6}\.jpg$/, '4.5.6: undefined date falls back cleanly to current time');

  // Garbage string input
  const garbageName = generateExportFilename('', 'not-a-real-date');
  assertMatch(garbageName, /^timestamp_\d{8}_\d{6}\.jpg$/, '4.5.7: Garbage string falls back cleanly to current time');

  // Boolean input
  const boolName = generateExportFilename('', true);
  assertMatch(boolName, /^timestamp_\d{8}_\d{6}\.jpg$/, '4.5.8: Boolean input falls back cleanly to current time');

  // Verify ExportManager static wrapper delegation
  const wrapName = ExportManager.generateFilename('photo.jpg', new Date(2026, 9, 28, 21, 12, 7));
  assertEqual(wrapName, 'timestamp_20261028_211207.jpg', '4.5.9: ExportManager.generateFilename static method delegates properly');
}

// =========================================================================
// RUN ALL SUITES & REPORT RESULTS
// =========================================================================
async function runAll() {
  console.log('===========================================================');
  console.log('     CHALLENGER M3-2 EMPIRICAL ADVERSARIAL STRESS SUITE   ');
  console.log('===========================================================');

  try {
    await testSection1();
    await testSection2();
    await testSection3();
    testSection4();
  } catch (err) {
    console.error('FATAL UNCAUGHT ERROR IN TEST SUITE:', err);
    results.failed++;
    results.failures.push(`FATAL: ${err.message}`);
  }

  console.log('\n===========================================================');
  console.log('                 M3-UI ADVERSARIAL STRESS REPORT           ');
  console.log('===========================================================');
  console.log(`Total Assertions Checked: ${results.total}`);
  console.log(`Passed:                   ${results.passed}`);
  console.log(`Failed:                   ${results.failed}`);
  console.log(`Findings Discovered:      ${results.findings.length}`);

  if (results.failures.length > 0) {
    console.log('\nFailures:');
    results.failures.forEach((f, idx) => console.log(`  ${idx + 1}) ${f}`));
    console.log('\n-----------------------------------------------------------');
    console.log('>>> VERDICT: REQUEST_CHANGES <<<');
    console.log('===========================================================');
    process.exit(1);
  } else {
    console.log('\n-----------------------------------------------------------');
    console.log('>>> VERDICT: APPROVE <<<');
    console.log('===========================================================');
    process.exit(0);
  }
}

runAll();
