/**
 * tests/core.test.js
 * Comprehensive Unit Test Suite for Milestone M1-CORE.
 * Verifies all 5 core logic and data engines:
 * - js/thai-datetime.js
 * - js/coordinates.js
 * - js/geocoder.js
 * - js/presets.js
 * - js/exif-parser.js
 */

import { describe, test } from './test-runner.js';
import {
  assert,
  assertEqual,
  assertDeepEqual,
  assertMatch,
  MockLocalStorage,
  setMockLocalStorage
} from './test-utils.js';

import {
  THAI_MONTHS_SHORT,
  THAI_MONTHS_FULL,
  isValidDate,
  toValidDate,
  formatThaiBuddhistDate,
  formatThaiDateOnly,
  formatTimeOnly,
  parseThaiBuddhistDate,
  toDatetimeLocalString,
  fromDatetimeLocalString
} from '../js/thai-datetime.js';

import {
  isValidCoordinate,
  formatSignedComponent,
  formatCoordinates,
  parseCoordinatePair,
  parseDMS,
  parseMapUrl,
  isShortMapUrl,
  parseLocationInput
} from '../js/coordinates.js';

import {
  THAI_SPATIAL_INDEX,
  lookupOfflineAddress,
  formatThaiAddress,
  parseNominatimAddress,
  fetchOnlineAddress,
  resolveThaiAddress,
  clearAddressCache,
  getAddressCacheSize
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

import {
  ExifParser,
  parseExif,
  parseExifSync,
  dmsToDecimal,
  getOrientationTransform,
  parseExifDate,
  applyCanvasTransform
} from '../js/exif-parser.js';

// =========================================================================
// 1. Thai Datetime Engine Tests
// =========================================================================
describe('Core Engine: Thai Datetime', () => {
  test('Exact match for reference date: 28 ต.ค. 2569 21:12:07', () => {
    const d = new Date(2026, 9, 28, 21, 12, 7);
    assertEqual(formatThaiBuddhistDate(d), '28 ต.ค. 2569 21:12:07');
  });

  test('formatThaiDateOnly and formatTimeOnly', () => {
    const d = new Date(2026, 9, 28, 21, 12, 7);
    assertEqual(formatThaiDateOnly(d), '28 ต.ค. 2569');
    assertEqual(formatTimeOnly(d), '21:12:07');
  });

  test('All 12 Thai month abbreviations correctly defined', () => {
    assertEqual(THAI_MONTHS_SHORT.length, 12);
    assertEqual(THAI_MONTHS_SHORT[0], 'ม.ค.');
    assertEqual(THAI_MONTHS_SHORT[9], 'ต.ค.');
    assertEqual(THAI_MONTHS_SHORT[11], 'ธ.ค.');
  });

  test('Parse valid Thai Buddhist Era string to Date', () => {
    const d = parseThaiBuddhistDate('28 ต.ค. 2569 21:12:07');
    assert(d instanceof Date);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 9);
    assertEqual(d.getDate(), 28);
    assertEqual(d.getHours(), 21);
    assertEqual(d.getMinutes(), 12);
    assertEqual(d.getSeconds(), 7);
  });

  test('Parse leap day in leap year BE 2567 (CE 2024)', () => {
    const d = parseThaiBuddhistDate('29 ก.พ. 2567 12:00:00');
    assert(d !== null, 'Valid leap day must parse');
    assertEqual(d.getFullYear(), 2024);
  });

  test('Reject invalid leap day in non-leap year BE 2568 (CE 2025)', () => {
    const d = parseThaiBuddhistDate('29 ก.พ. 2568 12:00:00');
    assertEqual(d, null, '29 Feb 2025 must be rejected');
  });

  test('Reject invalid calendar days (31 Apr)', () => {
    const d = parseThaiBuddhistDate('31 เม.ย. 2569 12:00:00');
    assertEqual(d, null, '31 April does not exist');
  });

  test('HTML5 datetime-local roundtrip conversion', () => {
    const original = new Date(2026, 9, 28, 21, 12, 7);
    const localStr = toDatetimeLocalString(original);
    assertEqual(localStr, '2026-10-28T21:12:07');
    const parsed = fromDatetimeLocalString(localStr);
    assertEqual(parsed.getFullYear(), 2026);
    assertEqual(parsed.getMonth(), 9);
    assertEqual(parsed.getDate(), 28);
    assertEqual(parsed.getHours(), 21);
    assertEqual(parsed.getMinutes(), 12);
    assertEqual(parsed.getSeconds(), 7);
  });

  test('Invalid inputs return safe empty or null results', () => {
    assertEqual(formatThaiBuddhistDate(new Date('invalid')), '');
    assertEqual(formatThaiBuddhistDate(null), '');
    assertEqual(toDatetimeLocalString(null), '');
    assertEqual(fromDatetimeLocalString('not-a-date'), null);
    assertEqual(parseThaiBuddhistDate('invalid text'), null);
  });
});

// =========================================================================
// 2. GPS Coordinates Engine Tests
// =========================================================================
describe('Core Engine: GPS Coordinates', () => {
  test('Exact match for reference coordinate: +6.499413,+101.267206', () => {
    assertEqual(formatCoordinates(6.499413, 101.267206), '+6.499413,+101.267206');
  });

  test('Signs and 6-decimal formatting', () => {
    assertEqual(formatCoordinates(0, 0), '+0.000000,+0.000000');
    assertEqual(formatCoordinates(-12.345678, -45.678901), '-12.345678,-45.678901');
    assertEqual(formatCoordinates(13.75, 100.49), '+13.750000,+100.490000');
  });

  test('Negative zero protection', () => {
    assertEqual(formatSignedComponent(-0.000000001), '+0.000000');
  });

  test('Boundary checking isValidCoordinate', () => {
    assert(isValidCoordinate(90, 180));
    assert(isValidCoordinate(-90, -180));
    assert(!isValidCoordinate(90.1, 0));
    assert(!isValidCoordinate(0, 180.1));
    assert(!isValidCoordinate(NaN, 100));
  });

  test('parseCoordinatePair with various delimiters', () => {
    assertEqual(parseCoordinatePair('+6.499413,+101.267206').lat, 6.499413);
    assertEqual(parseCoordinatePair('6.499413, 101.267206').lon, 101.267206);
    assertEqual(parseCoordinatePair('6.499413 101.267206').lat, 6.499413);
    assertEqual(parseCoordinatePair('-33.8688; +151.2093').lat, -33.8688);
    assertEqual(parseCoordinatePair('invalid'), null);
  });

  test('parseDMS converts degrees minutes seconds', () => {
    const res = parseDMS('6°29\'57.9"N 101°16\'01.9"E');
    assert(res !== null);
    assertEqual(Number(res.lat.toFixed(4)), 6.4994);
    assertEqual(Number(res.lon.toFixed(4)), 101.2672);

    const sw = parseDMS('12°20\'00"S 77°01\'00"W');
    assert(sw.lat < 0);
    assert(sw.lon < 0);
  });

  test('Universal map link parser extracts coordinates', () => {
    // Google @
    assertEqual(parseMapUrl('https://www.google.com/maps/@6.499413,101.267206,17z').lat, 6.499413);
    // Google data
    assertEqual(parseMapUrl('https://www.google.com/maps/place/X/data=!3m1!4b1!4m6!3m5!1s0x0!8m2!3d6.499413!4d101.267206').lon, 101.267206);
    // Google query
    assertEqual(parseMapUrl('https://maps.google.com/?q=6.499413,101.267206').lat, 6.499413);
    // Apple Maps
    assertEqual(parseMapUrl('https://maps.apple.com/?ll=6.499413,101.267206').lat, 6.499413);
    // OpenStreetMap
    assertEqual(parseMapUrl('https://www.openstreetmap.org/#map=16/6.499413/101.267206').lat, 6.499413);
    // Geo URI
    assertEqual(parseMapUrl('geo:6.499413,101.267206').lon, 101.267206);
  });

  test('Short map URL detector', () => {
    assert(isShortMapUrl('https://maps.app.goo.gl/abcdef'));
    assert(!isShortMapUrl('https://www.google.com/maps/@6,101'));
  });

  test('Universal parseLocationInput router', () => {
    assert(parseLocationInput('https://maps.google.com/?q=6.499413,101.267206') !== null);
    assert(parseLocationInput('+6.499413,+101.267206') !== null);
    assert(parseLocationInput('garbage') === null);
  });
});

// =========================================================================
// 3. Reverse Geocoder Engine Tests
// =========================================================================
describe('Core Engine: Reverse Geocoder', () => {
  test('THAI_SPATIAL_INDEX covers all 77 provinces', () => {
    assert(THAI_SPATIAL_INDEX.length >= 77);
  });

  test('Tier 1 offline resolution for Yala reference coordinates', () => {
    const addr = lookupOfflineAddress(6.499413, 101.267206);
    assertEqual(addr, 'อ.เมืองยะลา, จ.ยะลา');
  });

  test('Tier 1 offline resolution for Bangkok Grand Palace', () => {
    const addr = lookupOfflineAddress(13.7500, 100.4914);
    assertEqual(addr, 'เขตพระนคร, กรุงเทพมหานคร');
  });

  test('Tier 1 offline resolution for Chiang Mai', () => {
    const addr = lookupOfflineAddress(18.7883, 98.9853);
    assertEqual(addr, 'อ.เมืองเชียงใหม่, จ.เชียงใหม่');
  });

  test('Fast reject for foreign coordinates outside Thailand', () => {
    const addr = lookupOfflineAddress(35.681236, 139.767125);
    assertEqual(addr, '');
  });

  test('Lookup execution speed benchmark is strictly < 0.2ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      lookupOfflineAddress(6.499413, 101.267206);
    }
    const avgMs = (performance.now() - t0) / 1000;
    assert(avgMs < 0.2, `Average lookup time ${avgMs}ms is < 0.2ms`);
  });

  test('formatThaiAddress normalizes district and province prefixes', () => {
    assertEqual(formatThaiAddress('เมืองยะลา', 'ยะลา'), 'อ.เมืองยะลา, จ.ยะลา');
    assertEqual(formatThaiAddress('อำเภอเมืองยะลา', 'จังหวัดยะลา'), 'อ.เมืองยะลา, จ.ยะลา');
    assertEqual(formatThaiAddress('พระนคร', 'กรุงเทพมหานคร'), 'เขตพระนคร, กรุงเทพมหานคร');
    assertEqual(formatThaiAddress('เมืองพัทยา', 'ชลบุรี'), 'เมืองพัทยา, จ.ชลบุรี');
  });

  test('parseNominatimAddress normalizes OSM JSON objects', () => {
    const bkkObj = { suburb: 'เขตพระนคร', province: 'กรุงเทพมหานคร' };
    assertEqual(parseNominatimAddress(bkkObj), 'เขตพระนคร, กรุงเทพมหานคร');

    const provObj = { county: 'อำเภอเบตง', province: 'จังหวัดยะลา' };
    assertEqual(parseNominatimAddress(provObj), 'อ.เบตง, จ.ยะลา');
  });

  test('resolveThaiAddress offline fallback and cache management', async () => {
    clearAddressCache();
    assertEqual(getAddressCacheSize(), 0);

    let callbackAddress = '';
    const addr = await resolveThaiAddress(6.499413, 101.267206, {
      onUpdate: (a) => { callbackAddress = a; }
    });

    assert(addr.includes('ยะลา'));
    assert(callbackAddress.includes('ยะลา'));
  });
});

// =========================================================================
// 4. Presets Engine Tests
// =========================================================================
describe('Core Engine: Location Presets', () => {
  test('8 Default factory presets provided with Yala reference at index 0', () => {
    const defaults = getDefaultPresets();
    assertEqual(defaults.length, 8);
    assertEqual(defaults[0].id, 'preset_yala_ref');
    assertEqual(defaults[0].lat, 6.499413);
    assertEqual(defaults[0].lon, 101.267206);
    assertEqual(defaults[0].address, 'อ.เมืองยะลา, จ.ยะลา');
  });

  test('validatePresetInput checks name, coordinates and address lengths', () => {
    assert(validatePresetInput({ name: 'จุดตรวจ', lat: 6.5, lon: 101.2, address: 'ยะลา' }).valid);
    assert(!validatePresetInput({ name: '', lat: 6.5, lon: 101.2 }).valid);
    assert(!validatePresetInput({ name: 'ทดสอบ', lat: 95.0, lon: 100.0 }).valid);
  });

  test('saveCustomPreset and deleteCustomPreset with localStorage', () => {
    const mock = new MockLocalStorage();
    setMockLocalStorage(mock);

    const saved = saveCustomPreset({
      name: 'จุดสกัด 1',
      lat: 6.5411,
      lon: 101.2813,
      address: 'อ.เมืองยะลา, จ.ยะลา'
    });

    assert(saved !== null);
    assertEqual(saved.name, 'จุดสกัด 1');

    const customs = getCustomPresets();
    assert(customs.some(p => p.id === saved.id));

    const all = getAllPresets();
    assertEqual(all.length, 9); // 1 custom + 8 defaults

    const deleted = deleteCustomPreset(saved.id);
    assert(deleted);
    assertEqual(getCustomPresets().length, 0);
  });

  test('Factory presets are protected from deletion', () => {
    const deleted = deleteCustomPreset('preset_yala_ref');
    assertEqual(deleted, false, 'Default factory preset must not be deletable');
  });
});

// =========================================================================
// 5. EXIF Parser Engine Tests
// =========================================================================
describe('Core Engine: EXIF Parser', () => {
  test('dmsToDecimal calculates signed decimal coordinates', () => {
    assertEqual(dmsToDecimal([12, 30, 0], 'N'), 12.5);
    assertEqual(dmsToDecimal([12, 30, 0], 'S'), -12.5);
    assertEqual(dmsToDecimal([45, 15, 0], 'E'), 45.25);
    assertEqual(dmsToDecimal([45, 15, 0], 'W'), -45.25);
  });

  test('getOrientationTransform calculates rotation and dimension swaps', () => {
    const t1 = getOrientationTransform(1, 1024, 768);
    assertEqual(t1.rotate, 0);
    assertEqual(t1.width, 1024);
    assertEqual(t1.height, 768);

    const t6 = getOrientationTransform(6, 1024, 768);
    assertEqual(t6.rotate, 90);
    assertEqual(t6.width, 768);
    assertEqual(t6.height, 1024);

    const t3 = getOrientationTransform(3, 1024, 768);
    assertEqual(t3.rotate, 180);

    const t8 = getOrientationTransform(8, 1024, 768);
    assertEqual(t8.rotate, 270);
    assertEqual(t8.width, 768);
  });

  test('parseExifDate parses EXIF format YYYY:MM:DD HH:mm:ss', () => {
    const d = parseExifDate('2026:10:28 21:12:07');
    assert(d instanceof Date);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 9);
    assertEqual(d.getDate(), 28);
    assertEqual(d.getHours(), 21);
    assertEqual(d.getMinutes(), 12);
    assertEqual(d.getSeconds(), 7);
  });

  test('parseExifDate returns null for unconfigured clock 0000:00:00', () => {
    assertEqual(parseExifDate('0000:00:00 00:00:00'), null);
  });

  test('parseExif returns safe empty result for non-EXIF JPEG', async () => {
    const nonExifJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0xFF, 0xD9]).buffer;
    const res = await parseExif(nonExifJpeg);
    assert(res !== null);
    assertEqual(res.hasExif, false);
    assertEqual(res.dateTime, null);
    assertEqual(res.latitude, null);
  });

  test('parseExif returns safe empty result for null or empty buffer', async () => {
    const res = await parseExif(null);
    assertEqual(res.hasExif, false);
  });
});


// =========================================================================
// 6. Binary Synthetic JPEG EXIF Parser Tests (Little-Endian & Big-Endian)
// =========================================================================
function createSyntheticExifJpeg({
  littleEndian = true,
  orientation = 6,
  dateTime = '2026:10:28 21:12:07',
  lat = 6.499413,
  lon = 101.267206,
  latRef = 'N',
  lonRef = 'E',
  altitude = 25.5
} = {}) {
  const buf = new Uint8Array(2048);
  const dv = new DataView(buf.buffer);
  let pos = 0;

  // JPEG SOI
  dv.setUint16(pos, 0xFFD8, false); pos += 2;

  // APP1 Marker
  dv.setUint16(pos, 0xFFE1, false); pos += 2;
  const app1LenPos = pos;
  pos += 2;

  // 'Exif\0\0'
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let i = 0; i < 6; i++) dv.setUint8(pos++, exifHeader[i]);

  const tiffStart = pos;
  const isLE = littleEndian;

  // TIFF Header
  dv.setUint16(pos, isLE ? 0x4949 : 0x4D4D, false); pos += 2;
  dv.setUint16(pos, 0x002A, isLE); pos += 2;
  dv.setUint32(pos, 8, isLE); pos += 4; // IFD0 at offset 8

  // IFD0: 3 entries (Orientation, ExifPointer, GPSPointer)
  dv.setUint16(pos, 3, isLE); pos += 2;

  // Tag 0x0112: Orientation
  dv.setUint16(pos, 0x0112, isLE);
  dv.setUint16(pos + 2, 3, isLE); // SHORT
  dv.setUint32(pos + 4, 1, isLE); // Count 1
  dv.setUint16(pos + 8, orientation, isLE);
  pos += 12;

  // Tag 0x8769: ExifIFDPointer
  const exifPtrPos = pos;
  dv.setUint16(pos, 0x8769, isLE);
  dv.setUint16(pos + 2, 4, isLE); // LONG
  dv.setUint32(pos + 4, 1, isLE);
  pos += 12;

  // Tag 0x8825: GPSInfoIFDPointer
  const gpsPtrPos = pos;
  dv.setUint16(pos, 0x8825, isLE);
  dv.setUint16(pos + 2, 4, isLE); // LONG
  dv.setUint32(pos + 4, 1, isLE);
  pos += 12;

  dv.setUint32(pos, 0, isLE); pos += 4; // Next IFD

  // Exif SubIFD
  const exifSubRel = pos - tiffStart;
  dv.setUint32(exifPtrPos + 8, exifSubRel, isLE);

  dv.setUint16(pos, 1, isLE); pos += 2; // 1 entry: DateTimeOriginal
  const dtoPos = pos;
  dv.setUint16(pos, 0x9003, isLE);
  dv.setUint16(pos + 2, 2, isLE); // ASCII
  dv.setUint32(pos + 4, 20, isLE);
  pos += 12;
  dv.setUint32(pos, 0, isLE); pos += 4;

  const dateStrRel = pos - tiffStart;
  dv.setUint32(dtoPos + 8, dateStrRel, isLE);
  const dateStr = (dateTime + '\0').padEnd(20, '\0');
  for (let i = 0; i < 20; i++) dv.setUint8(pos++, dateStr.charCodeAt(i));

  // GPS SubIFD
  const gpsSubRel = pos - tiffStart;
  dv.setUint32(gpsPtrPos + 8, gpsSubRel, isLE);

  dv.setUint16(pos, 6, isLE); pos += 2; // 6 entries: LatRef, Lat, LonRef, Lon, AltRef, Alt

  // 1. GPSLatitudeRef
  dv.setUint16(pos, 0x0001, isLE);
  dv.setUint16(pos + 2, 2, isLE);
  dv.setUint32(pos + 4, 2, isLE);
  dv.setUint8(pos + 8, latRef.charCodeAt(0));
  dv.setUint8(pos + 9, 0);
  pos += 12;

  // 2. GPSLatitude
  const latPos = pos;
  dv.setUint16(pos, 0x0002, isLE);
  dv.setUint16(pos + 2, 5, isLE); // RATIONAL
  dv.setUint32(pos + 4, 3, isLE);
  pos += 12;

  // 3. GPSLongitudeRef
  dv.setUint16(pos, 0x0003, isLE);
  dv.setUint16(pos + 2, 2, isLE);
  dv.setUint32(pos + 4, 2, isLE);
  dv.setUint8(pos + 8, lonRef.charCodeAt(0));
  dv.setUint8(pos + 9, 0);
  pos += 12;

  // 4. GPSLongitude
  const lonPos = pos;
  dv.setUint16(pos, 0x0004, isLE);
  dv.setUint16(pos + 2, 5, isLE);
  dv.setUint32(pos + 4, 3, isLE);
  pos += 12;

  // 5. GPSAltitudeRef
  dv.setUint16(pos, 0x0005, isLE);
  dv.setUint16(pos + 2, 1, isLE);
  dv.setUint32(pos + 4, 1, isLE);
  dv.setUint8(pos + 8, altitude >= 0 ? 0 : 1);
  pos += 12;

  // 6. GPSAltitude
  const altPos = pos;
  dv.setUint16(pos, 0x0006, isLE);
  dv.setUint16(pos + 2, 5, isLE);
  dv.setUint32(pos + 4, 1, isLE);
  pos += 12;

  dv.setUint32(pos, 0, isLE); pos += 4;

  // Write Latitude Rationals
  const latRel = pos - tiffStart;
  dv.setUint32(latPos + 8, latRel, isLE);
  const latD = Math.floor(Math.abs(lat));
  const latMRem = (Math.abs(lat) - latD) * 60;
  const latM = Math.floor(latMRem);
  const latS = Math.round((latMRem - latM) * 60 * 10000);
  dv.setUint32(pos, latD, isLE); dv.setUint32(pos + 4, 1, isLE); pos += 8;
  dv.setUint32(pos, latM, isLE); dv.setUint32(pos + 4, 1, isLE); pos += 8;
  dv.setUint32(pos, latS, isLE); dv.setUint32(pos + 4, 10000, isLE); pos += 8;

  // Write Longitude Rationals
  const lonRel = pos - tiffStart;
  dv.setUint32(lonPos + 8, lonRel, isLE);
  const lonD = Math.floor(Math.abs(lon));
  const lonMRem = (Math.abs(lon) - lonD) * 60;
  const lonM = Math.floor(lonMRem);
  const lonS = Math.round((lonMRem - lonM) * 60 * 10000);
  dv.setUint32(pos, lonD, isLE); dv.setUint32(pos + 4, 1, isLE); pos += 8;
  dv.setUint32(pos, lonM, isLE); dv.setUint32(pos + 4, 1, isLE); pos += 8;
  dv.setUint32(pos, lonS, isLE); dv.setUint32(pos + 4, 10000, isLE); pos += 8;

  // Write Altitude Rational
  const altRel = pos - tiffStart;
  dv.setUint32(altPos + 8, altRel, isLE);
  const altVal = Math.round(Math.abs(altitude) * 10);
  dv.setUint32(pos, altVal, isLE); dv.setUint32(pos + 4, 10, isLE); pos += 8;

  // Write APP1 Segment Length
  const app1Len = pos - app1LenPos;
  dv.setUint16(app1LenPos, app1Len, false);

  // JPEG EOI
  dv.setUint16(pos, 0xFFD9, false); pos += 2;

  return buf.subarray(0, pos);
}

describe('Core Engine: Synthetic Binary EXIF JPEG Parsing', () => {
  test('Parses Little-Endian ("II") binary EXIF JPEG buffer', async () => {
    const jpegBuf = createSyntheticExifJpeg({ littleEndian: true, orientation: 6 });
    const meta = await parseExif(jpegBuf);
    assert(meta !== null);
    assertEqual(meta.hasExif, true);
    assertEqual(meta.orientation, 6);
    assertEqual(meta.dateTimeOriginalStr, '2026:10:28 21:12:07');
    assert(meta.dateTime instanceof Date);
    assertEqual(meta.dateTime.getFullYear(), 2026);
    assertEqual(Number(meta.latitude.toFixed(4)), 6.4994);
    assertEqual(Number(meta.longitude.toFixed(4)), 101.2672);
  });

  test('Parses Big-Endian ("MM") binary EXIF JPEG buffer with negative Southern coordinates', async () => {
    const jpegBuf = createSyntheticExifJpeg({
      littleEndian: false,
      orientation: 3,
      lat: 33.8568,
      latRef: 'S',
      lon: 151.2153,
      lonRef: 'W',
      dateTime: '2025:06:15 14:30:00'
    });
    const meta = await parseExif(jpegBuf);
    assert(meta !== null);
    assertEqual(meta.hasExif, true);
    assertEqual(meta.orientation, 3);
    assert(meta.latitude < 0, 'South latitude must be negative');
    assert(meta.longitude < 0, 'West longitude must be negative');
    assertEqual(Number(meta.latitude.toFixed(4)), -33.8568);
    assertEqual(Number(meta.longitude.toFixed(4)), -151.2153);
  });
});
