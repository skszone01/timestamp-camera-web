import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExifSync } from '../js/exif-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildExifJpeg({ lat, lon, dateStr = '2026:10:28 21:12:07' }) {
  const tiff = Buffer.alloc(512);
  let pos = 0;
  tiff.writeUInt16LE(0x4949, pos); pos += 2; // 'II'
  tiff.writeUInt16LE(0x002A, pos); pos += 2; // 42
  tiff.writeUInt32LE(8, pos); pos += 4;      // IFD0 offset

  // IFD0: 2 entries -> Orientation (0x0112) + GPS Pointer (0x8825)
  tiff.writeUInt16LE(2, pos); pos += 2;
  // Orientation: tag 0x0112, type SHORT (3), count 1, value 1
  tiff.writeUInt16LE(0x0112, pos); pos += 2;
  tiff.writeUInt16LE(3, pos); pos += 2;
  tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt16LE(1, pos); pos += 2; pos += 2;

  // GPS Pointer: tag 0x8825, type LONG (4), count 1, value -> offset
  const gpsPtrPos = pos;
  tiff.writeUInt16LE(0x8825, pos); pos += 2;
  tiff.writeUInt16LE(4, pos); pos += 2;
  tiff.writeUInt32LE(1, pos); pos += 4;
  pos += 4; // reserve 4 bytes for offset
  tiff.writeUInt32LE(0, pos); pos += 4; // Next IFD offset = 0

  const gpsOffset = pos;
  tiff.writeUInt32LE(gpsOffset, gpsPtrPos + 8);

  // GPS IFD: 4 entries: LatRef (1), Lat (2), LonRef (3), Lon (4)
  tiff.writeUInt16LE(4, pos); pos += 2;

  // 1. LatRef: ASCII (2), count 2 ('N\0' or 'S\0')
  tiff.writeUInt16LE(0x0001, pos); pos += 2;
  tiff.writeUInt16LE(2, pos); pos += 2;
  tiff.writeUInt32LE(2, pos); pos += 4;
  tiff.write(lat >= 0 ? 'N\0' : 'S\0', pos); pos += 4;

  // 2. Lat: RATIONAL (5), count 3
  const latPos = pos;
  tiff.writeUInt16LE(0x0002, pos); pos += 2;
  tiff.writeUInt16LE(5, pos); pos += 2;
  tiff.writeUInt32LE(3, pos); pos += 4;
  pos += 4; // reserve 4 bytes for value offset

  // 3. LonRef: ASCII (2), count 2 ('E\0' or 'W\0')
  tiff.writeUInt16LE(0x0003, pos); pos += 2;
  tiff.writeUInt16LE(2, pos); pos += 2;
  tiff.writeUInt32LE(2, pos); pos += 4;
  tiff.write(lon >= 0 ? 'E\0' : 'W\0', pos); pos += 4;

  // 4. Lon: RATIONAL (5), count 3
  const lonPos = pos;
  tiff.writeUInt16LE(0x0004, pos); pos += 2;
  tiff.writeUInt16LE(5, pos); pos += 2;
  tiff.writeUInt32LE(3, pos); pos += 4;
  pos += 4; // reserve 4 bytes for value offset
  tiff.writeUInt32LE(0, pos); pos += 4; // Next IFD = 0

  // Rationals data:
  // Lat values (D, M, S)
  tiff.writeUInt32LE(pos, latPos + 8);
  const absLat = Math.abs(lat);
  const latD = Math.floor(absLat);
  const latMRem = (absLat - latD) * 60;
  const latM = Math.floor(latMRem);
  const latS = Math.round((latMRem - latM) * 60 * 10000);
  tiff.writeUInt32LE(latD, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(latM, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(latS, pos); pos += 4; tiff.writeUInt32LE(10000, pos); pos += 4;

  // Lon values (D, M, S)
  tiff.writeUInt32LE(pos, lonPos + 8);
  const absLon = Math.abs(lon);
  const lonD = Math.floor(absLon);
  const lonMRem = (absLon - lonD) * 60;
  const lonM = Math.floor(lonMRem);
  const lonS = Math.round((lonMRem - lonM) * 60 * 10000);
  tiff.writeUInt32LE(lonD, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(lonM, pos); pos += 4; tiff.writeUInt32LE(1, pos); pos += 4;
  tiff.writeUInt32LE(lonS, pos); pos += 4; tiff.writeUInt32LE(10000, pos); pos += 4;

  const tiffData = tiff.subarray(0, pos);
  const app1Payload = Buffer.concat([Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), tiffData]);
  const app1Marker = Buffer.alloc(4);
  app1Marker.writeUInt16BE(0xFFE1, 0);
  app1Marker.writeUInt16BE(app1Payload.length + 2, 2);

  // Minimal valid 8x8 grayscale JPEG tail
  const minimalTail = Buffer.from([
    0xFF, 0xDB, 0x00, 0x43, 0x00,
    0x10, 0x0B, 0x0C, 0x0E, 0x0C, 0x0A, 0x10, 0x0E, 0x0D, 0x0E, 0x12, 0x11, 0x10, 0x13, 0x18,
    0x28, 0x1A, 0x18, 0x16, 0x16, 0x18, 0x31, 0x23, 0x25, 0x1D, 0x28, 0x3A, 0x33, 0x3D, 0x3C,
    0x39, 0x33, 0x38, 0x37, 0x40, 0x48, 0x5C, 0x4E, 0x40, 0x44, 0x57, 0x45, 0x37, 0x38, 0x50,
    0x6D, 0x51, 0x57, 0x5F, 0x62, 0x67, 0x68, 0x67, 0x3E, 0x4D, 0x71, 0x79, 0x70, 0x64, 0x78,
    0x5C, 0x65, 0x67, 0x63,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00,
    0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    0x7F, 0x00,
    0xFF, 0xD9
  ]);

  return Buffer.concat([Buffer.from([0xFF, 0xD8]), app1Marker, app1Payload, minimalTail]);
}

const samplesDir = path.resolve(__dirname, '../assets/samples');
if (!fs.existsSync(samplesDir)) {
  fs.mkdirSync(samplesDir, { recursive: true });
}

const samples = [
  { file: 'yala-sample.jpg', lat: 6.499413, lon: 101.267206 },
  { file: 'bkk-sample.jpg', lat: 13.750000, lon: 100.491400 },
  { file: 'cnx-sample.jpg', lat: 18.588889, lon: 98.486944 }
];

for (const s of samples) {
  const filePath = path.join(samplesDir, s.file);
  const buf = buildExifJpeg({ lat: s.lat, lon: s.lon });
  fs.writeFileSync(filePath, buf);
  console.log(`Generated: ${s.file} (${buf.length} bytes)`);

  // Verify EXIF parsing
  const parsed = parseExifSync(buf);
  if (!parsed.hasExif || Math.abs(parsed.latitude - s.lat) > 0.0001 || Math.abs(parsed.longitude - s.lon) > 0.0001) {
    throw new Error(`Verification failed for ${s.file}: got lat=${parsed.latitude}, lon=${parsed.longitude}`);
  }
  console.log(`Verified ${s.file}: lat=${parsed.latitude}, lon=${parsed.longitude}`);
}

console.log('All sample images created and verified successfully!');
