#!/usr/bin/env node
/**
 * tests/m5-final-adversarial.js
 * 
 * Milestone M5-FINAL Empirical Adversarial Verification Suite
 * Verifies:
 * 1. Apple HEIC/HEIF ISOBMFF Container EXIF GPS Parsing
 * 2. Decoupled EXIF GPS Primary & User Datetime Invariant
 * 3. Doi Inthanon Summit / Chom Thong Centroid Reverse Geocoding
 * 4. Sample JPEG Assets Binary EXIF Integrity (+6.499413,+101.267206)
 * 5. Light Studio Editor 4-Zone DOM Architecture & 47 Preserved IDs
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

import { parseExifSync } from '../js/exif-parser.js';
import { lookupOfflineAddress } from '../js/geocoder.js';
import { appState, applyExifMetadata, resetDefaults, getState, setCustomDateTime, setLiveTime } from '../js/state.js';
import { formatCoordinates } from '../js/coordinates.js';
import { formatThaiBuddhistDate } from '../js/thai-datetime.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passed++;
  console.log(`  [PASS] ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    failed++;
    console.error(`  [FAIL] ${message} (Expected: ${expected}, Actual: ${actual})`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passed++;
  console.log(`  [PASS] ${message}`);
}

console.log('===========================================================');
console.log('   M5-FINAL EMPIRICAL ADVERSARIAL VERIFICATION SUITE       ');
console.log('===========================================================');

// =========================================================================
// SECTION 1: ISOBMFF Apple HEIC/HEIF EXIF Parsing & Fuzzing
// =========================================================================
console.log('\n--- SECTION 1: Apple HEIC/HEIF ISOBMFF EXIF Parsing ---');

function buildSyntheticIsobmffWithExif({ lat = 6.499413, lon = 101.267206, dateStr = '2026:10:28 21:12:07' } = {}) {
  // 1. Build TIFF GPS block
  const tiff = Buffer.alloc(512);
  let pos = 0;
  tiff.writeUInt16LE(0x4949, pos); pos += 2; // 'II'
  tiff.writeUInt16LE(0x002A, pos); pos += 2; // 42
  tiff.writeUInt32LE(8, pos); pos += 4;      // IFD0 offset

  // IFD0: Orientation + ExifSubIFD + GPS Pointer
  tiff.writeUInt16LE(3, pos); pos += 2;
  // Orientation
  tiff.writeUInt16LE(0x0112, pos); pos += 2;
  tiff.writeUInt16LE(3, pos); pos += 2;
  tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt16LE(1, pos); pos += 2; pos += 2;

  // ExifSubIFD
  const exifPtrPos = pos;
  tiff.writeUInt16LE(0x8769, pos); pos += 2;
  tiff.writeUInt16LE(4, pos); pos += 2;
  tiff.writeUInt32LE(1, pos); pos += 4;
  pos += 4;

  // GPS Pointer
  const gpsPtrPos = pos;
  tiff.writeUInt16LE(0x8825, pos); pos += 2;
  tiff.writeUInt16LE(4, pos); pos += 2;
  tiff.writeUInt32LE(1, pos); pos += 4;
  pos += 4;
  tiff.writeUInt32LE(0, pos); pos += 4; // Next IFD

  // Exif SubIFD
  const exifOffset = pos;
  tiff.writeUInt32LE(exifOffset, exifPtrPos + 8);
  tiff.writeUInt16LE(1, pos); pos += 2;
  // DateTimeOriginal (0x9003)
  const dtPos = pos;
  tiff.writeUInt16LE(0x9003, pos); pos += 2;
  tiff.writeUInt16LE(2, pos); pos += 2;
  tiff.writeUInt32LE(20, pos); pos += 4;
  pos += 4;
  tiff.writeUInt32LE(0, pos); pos += 4;

  // GPS IFD
  const gpsOffset = pos;
  tiff.writeUInt32LE(gpsOffset, gpsPtrPos + 8);
  tiff.writeUInt16LE(4, pos); pos += 2;

  // LatRef
  tiff.writeUInt16LE(0x0001, pos); pos += 2;
  tiff.writeUInt16LE(2, pos); pos += 2;
  tiff.writeUInt32LE(2, pos); pos += 4;
  tiff.write('N\0', pos); pos += 4;

  // Lat
  const latPos = pos;
  tiff.writeUInt16LE(0x0002, pos); pos += 2;
  tiff.writeUInt16LE(5, pos); pos += 2;
  tiff.writeUInt32LE(3, pos); pos += 4;
  pos += 4;

  // LonRef
  tiff.writeUInt16LE(0x0003, pos); pos += 2;
  tiff.writeUInt16LE(2, pos); pos += 2;
  tiff.writeUInt32LE(2, pos); pos += 4;
  tiff.write('E\0', pos); pos += 4;

  // Lon
  const lonPos = pos;
  tiff.writeUInt16LE(0x0004, pos); pos += 2;
  tiff.writeUInt16LE(5, pos); pos += 2;
  tiff.writeUInt32LE(3, pos); pos += 4;
  pos += 4;
  tiff.writeUInt32LE(0, pos); pos += 4;

  // Date String Data
  tiff.writeUInt32LE(pos, dtPos + 8);
  tiff.write(dateStr + '\0', pos); pos += 20;

  // Lat Rationals
  tiff.writeUInt32LE(pos, latPos + 8);
  const latD = Math.floor(lat);
  const latMRem = (lat - latD) * 60;
  const latM = Math.floor(latMRem);
  const latS = Math.round((latMRem - latM) * 60 * 10000);
  tiff.writeUInt32LE(latD, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(latM, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(latS, pos); pos += 4; tiff.writeUInt32LE(10000, pos); pos += 4;

  // Lon Rationals
  tiff.writeUInt32LE(pos, lonPos + 8);
  const lonD = Math.floor(lon);
  const lonMRem = (lon - lonD) * 60;
  const lonM = Math.floor(lonMRem);
  const lonS = Math.round((lonMRem - lonM) * 60 * 10000);
  tiff.writeUInt32LE(lonD, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(lonM, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(lonS, pos); pos += 4; tiff.writeUInt32LE(10000, pos); pos += 4;

  const tiffData = tiff.subarray(0, pos);

  // 2. Wrap in ISOBMFF box hierarchy:
  // ftyp box (heic)
  const ftypBox = Buffer.from([
    0x00, 0x00, 0x00, 0x18, // size 24
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x68, 0x65, 0x69, 0x63, // major_brand 'heic'
    0x00, 0x00, 0x00, 0x00, // minor_version 0
    0x6d, 0x69, 0x66, 0x31, // compatible_brands 'mif1'
    0x68, 0x65, 0x69, 0x63  // 'heic'
  ]);

  // Exif payload box (Apple HEIC item payload with 'Exif\0\0' prefix)
  const exifPrefix = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const metaPayload = Buffer.concat([exifPrefix, tiffData]);
  const metaBoxHeader = Buffer.alloc(8);
  metaBoxHeader.writeUInt32BE(metaPayload.length + 8, 0);
  metaBoxHeader.write('meta', 4);

  return Buffer.concat([ftypBox, metaBoxHeader, metaPayload]);
}

const heicBuffer = buildSyntheticIsobmffWithExif();
const parsedHeic = parseExifSync(heicBuffer);
assert(parsedHeic.hasExif === true, 'S1.1: parseExifSync identifies ISOBMFF HEIC container with Exif box');
assert(Math.abs(parsedHeic.latitude - 6.499413) < 0.0001, `S1.2: HEIC GPS latitude parsed accurately (${parsedHeic.latitude})`);
assert(Math.abs(parsedHeic.longitude - 101.267206) < 0.0001, `S1.3: HEIC GPS longitude parsed accurately (${parsedHeic.longitude})`);
assert(parsedHeic.dateTime instanceof Date, 'S1.4: HEIC DateTimeOriginal parsed as Date');

// Fuzz test on corrupted HEIC ISOBMFF headers
for (let i = 0; i < 50; i++) {
  const corrupted = Buffer.from(heicBuffer);
  corrupted[Math.floor(Math.random() * corrupted.length)] = Math.floor(Math.random() * 256);
  let threw = false;
  try {
    parseExifSync(corrupted);
  } catch {
    threw = true;
  }
  assert(!threw, `S1.Fuzz.${i + 1}: Corrupted HEIC buffer must never throw uncaught exception`);
}

// =========================================================================
// SECTION 2: Decoupled EXIF GPS Primary & User Datetime Invariant
// =========================================================================
console.log('\n--- SECTION 2: Decoupled EXIF GPS & User Datetime Invariant ---');

resetDefaults();
const customDate = new Date(2030, 0, 1, 12, 0, 0); // Future date
setCustomDateTime(customDate);
assertEqual(getState().isLiveTime, false, 'S2.1: User custom date disabled live time');
assertEqual(getState().dateTime.getTime(), customDate.getTime(), 'S2.2: State holds custom future date');

// Simulate photo upload with GPS metadata
const mockUploadExif = {
  hasExif: true,
  latitude: 18.588889,
  longitude: 98.486944,
  dateTime: new Date(2020, 5, 15, 8, 30, 0), // Old photo date
  orientation: 1
};

// In photo upload workflow, applyDateTime MUST be false per user requirement:
// "ถ้าภาพที่ อัปโหลดมา มี พิกัด GPS ให้ ดึงมาเป็น ค่าเริ่มต้นเลย โดยแปลง เป็น อ. จ. ให้ด้วย แต่ ส่วนเวลาให้เลือกเอาเอง จะเป็น ย้อนหลัง หรือ อนาคต ก็ได้"
applyExifMetadata(mockUploadExif, { applyDateTime: false });

assertEqual(getState().lat, 18.588889, 'S2.3: GPS latitude auto-applied from photo EXIF');
assertEqual(getState().lon, 98.486944, 'S2.4: GPS longitude auto-applied from photo EXIF');
assert(getState().hasExifGps === true, 'S2.5: hasExifGps badge flag set to true');
assert(getState().address.includes('เชียงใหม่'), 'S2.6: Thai address auto-resolved to Chiang Mai');

// CRITICAL INVARIANT: User-chosen date and isLiveTime must NOT have been overwritten by photo date
assertEqual(getState().dateTime.getTime(), customDate.getTime(), 'S2.7: [CRITICAL INVARIANT] User date preserved untouched');
assertEqual(getState().isLiveTime, false, 'S2.8: [CRITICAL INVARIANT] User live time state preserved untouched');

// Also verify ticking live time preservation
resetDefaults();
setLiveTime(true);
assertEqual(getState().isLiveTime, true, 'S2.9: Live time active');
applyExifMetadata(mockUploadExif, { applyDateTime: false });
assertEqual(getState().isLiveTime, true, 'S2.10: [CRITICAL INVARIANT] Ticking clock is NOT frozen by photo EXIF');

// =========================================================================
// SECTION 3: Doi Inthanon Summit / Chom Thong Centroid Reverse Geocoder
// =========================================================================
console.log('\n--- SECTION 3: Doi Inthanon Summit / Chom Thong Centroid ---');

const inthanonLat = 18.588889;
const inthanonLon = 98.486944;
const inthanonAddr = lookupOfflineAddress(inthanonLat, inthanonLon);
assert(inthanonAddr.includes('เชียงใหม่'), `S3.1: Doi Inthanon resolves to Chiang Mai (got: ${inthanonAddr})`);
assert(inthanonAddr.includes('จอมทอง'), `S3.2: Doi Inthanon specifically resolves to Chom Thong district (got: ${inthanonAddr})`);
assertEqual(inthanonAddr, 'อ.จอมทอง, จ.เชียงใหม่', 'S3.3: Exact address format matching Thai administrative convention');

// =========================================================================
// SECTION 4: Sample JPEG Assets Binary EXIF Integrity
// =========================================================================
console.log('\n--- SECTION 4: Sample JPEG Assets Binary EXIF Integrity ---');

const samplesDir = path.join(ROOT_DIR, 'assets/samples');
assert(fs.existsSync(samplesDir), 'S4.1: assets/samples directory exists');

const expectedSamples = [
  { file: 'yala-sample.jpg', lat: 6.499413, lon: 101.267206, name: 'Yala Reference' },
  { file: 'bkk-sample.jpg', lat: 13.750000, lon: 100.491400, name: 'Bangkok Grand Palace' },
  { file: 'cnx-sample.jpg', lat: 18.588889, lon: 98.486944, name: 'Chiang Mai Doi Inthanon' }
];

for (const s of expectedSamples) {
  const filePath = path.join(samplesDir, s.file);
  assert(fs.existsSync(filePath), `S4.File: ${s.file} exists on disk`);
  const buf = fs.readFileSync(filePath);
  assert(buf.length > 200, `S4.Size: ${s.file} non-trivial size (${buf.length} bytes)`);

  const parsed = parseExifSync(buf);
  assert(parsed.hasExif === true, `S4.Exif: ${s.file} contains valid EXIF`);
  assert(Math.abs(parsed.latitude - s.lat) < 0.0001, `S4.Lat: ${s.file} latitude matches expected (${parsed.latitude} ~ ${s.lat})`);
  assert(Math.abs(parsed.longitude - s.lon) < 0.0001, `S4.Lon: ${s.file} longitude matches expected (${parsed.longitude} ~ ${s.lon})`);
}

// =========================================================================
// SECTION 5: Studio 4-Zone DOM Architecture & 47 Preserved IDs
// =========================================================================
console.log('\n--- SECTION 5: Studio 4-Zone Architecture & 47 Preserved IDs ---');

const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

const required47Ids = [
  'app', 'btn-reset-all', 'btn-quick-gps', 'viewfinder', 'preview-canvas',
  'viewfinder-placeholder', 'placeholder-camera-btn', 'placeholder-album-btn',
  'canvas-metadata-badge', 'meta-resolution', 'meta-orientation',
  'btn-album', 'btn-camera', 'camera-input', 'album-input', 'photo-upload', 'file-input',
  'card-datetime', 'live-time-toggle', 'datetime-picker-group', 'datetime-input', 'preview-line-datetime',
  'card-presets', 'preset-select', 'preset-chips', 'btn-save-preset',
  'card-coordinates', 'lat-input', 'lon-input', 'map-link-input', 'btn-parse-link', 'preview-line-coords',
  'card-address', 'address-status-badge', 'address-input', 'btn-toggle-address-lock', 'lock-icon',
  'btn-reset-address', 'preview-line-address', 'card-map', 'map',
  'card-actions', 'btn-export', 'export-spinner', 'btn-share', 'btn-download', 'toast-container'
];

assertEqual(required47Ids.length, 47, 'Exactly 47 IDs tracked for preservation');

for (const id of required47Ids) {
  const idPattern = new RegExp(`id=["']${id}["']`);
  assert(idPattern.test(indexHtml), `S5.ID: id="${id}" preserved in index.html`);
}

// Check Studio Editor 4-Zone Structure
assert(indexHtml.includes('class="studio-body"') || indexHtml.includes('studio-body'), 'S5.Layout.1: studio-body container exists');
assert(indexHtml.includes('class="studio-rail"') || indexHtml.includes('studio-rail'), 'S5.Layout.2: Left vertical icon rail exists');
assert(indexHtml.includes('class="studio-drawer"') || indexHtml.includes('studio-drawer'), 'S5.Layout.3: Left tool drawer exists');
assert(indexHtml.includes('class="main-workspace studio-stage"') || indexHtml.includes('studio-stage'), 'S5.Layout.4: Center canvas stage exists');
assert(indexHtml.includes('class="studio-inspector controls-section"') || indexHtml.includes('studio-inspector'), 'S5.Layout.5: Right inspector sidebar exists');

// Check 3 Sample Cards in Empty State
assert(indexHtml.includes('data-sample="yala"'), 'S5.Sample.1: Yala 9123 sample button present');
assert(indexHtml.includes('data-sample="bangkok"'), 'S5.Sample.2: Bangkok sample button present');
assert(indexHtml.includes('data-sample="chiangmai"'), 'S5.Sample.3: Chiang Mai sample button present');

// Check 4 Overview Pills & Watermark Summary
assert(indexHtml.includes('overview-pill') && indexHtml.includes('overview-pill-exif'), 'S5.Inspector.1: Overview pills exist with overview-pill-exif');
assert(indexHtml.includes('id="summary-datetime"') && indexHtml.includes('id="summary-coords"') && indexHtml.includes('id="summary-address"'), 'S5.Inspector.2: Watermark summary card fields present');
assert(indexHtml.includes('id="btn-replace-image"'), 'S5.Inspector.3: Replace image button present');

console.log('\n===========================================================');
console.log(` M5-FINAL EMPIRICAL VERIFICATION RESULT: ${passed} passed, ${failed} failed`);
console.log('===========================================================');
if (failed > 0) process.exit(1);
console.log('>>> VERDICT: ALL M5-FINAL TESTS PASSED WITH 100% SUCCESS <<<\n');
