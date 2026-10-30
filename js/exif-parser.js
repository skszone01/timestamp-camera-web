/**
 * exif-parser.js
 * 
 * Pure client-side zero-dependency binary EXIF parser.
 * Extracts Orientation, DateTimeOriginal, and GPS coordinates from JPEG, PNG, and WebP buffers.
 * Supports Little-Endian (0x4949 "II") and Big-Endian (0x4D4D "MM").
 * Part of Milestone M1-CORE for Timestamp Camera Web.
 */

/**
 * Converts DMS (Degrees, Minutes, Seconds) and directional reference to signed decimal degrees.
 * 
 * @param {number[]} dms - [degrees, minutes, seconds]
 * @param {string} [ref] - 'N', 'S', 'E', or 'W'
 * @returns {number|null} Signed decimal degrees
 */
export function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const [d, m, s] = dms;
  if (typeof d !== 'number' || typeof m !== 'number' || typeof s !== 'number') return null;

  let decimal = d + (m / 60) + (s / 3600);
  if (isNaN(decimal)) return null;

  if (ref && typeof ref === 'string') {
    const cleanRef = ref.replace(/\0/g, '').trim().toUpperCase();
    if (cleanRef.startsWith('S') || cleanRef.startsWith('W')) {
      decimal = -decimal;
    }
  }

  return Number(decimal.toFixed(6));
}

/**
 * Returns orientation transformation properties and rotated dimensions.
 * 
 * @param {number} orientation (1-8)
 * @param {number} [srcWidth=0] - Original image width
 * @param {number} [srcHeight=0] - Original image height
 * @returns {{ rotate: number, rotateDeg: number, width: number, height: number, flipH: boolean, flipV: boolean, swapDimensions: boolean }}
 */
export function getOrientationTransform(orientation, srcWidth = 0, srcHeight = 0) {
  switch (orientation) {
    case 2:
      return { rotate: 0, rotateDeg: 0, width: srcWidth, height: srcHeight, flipH: true, flipV: false, swapDimensions: false };
    case 3:
      return { rotate: 180, rotateDeg: 180, width: srcWidth, height: srcHeight, flipH: false, flipV: false, swapDimensions: false };
    case 4:
      return { rotate: 180, rotateDeg: 180, width: srcWidth, height: srcHeight, flipH: true, flipV: false, swapDimensions: false };
    case 5:
      return { rotate: 90, rotateDeg: 90, width: srcHeight, height: srcWidth, flipH: true, flipV: false, swapDimensions: true };
    case 6:
      return { rotate: 90, rotateDeg: 90, width: srcHeight, height: srcWidth, flipH: false, flipV: false, swapDimensions: true };
    case 7:
      return { rotate: 270, rotateDeg: 270, width: srcHeight, height: srcWidth, flipH: true, flipV: false, swapDimensions: true };
    case 8:
      return { rotate: 270, rotateDeg: 270, width: srcHeight, height: srcWidth, flipH: false, flipV: false, swapDimensions: true };
    default:
      return { rotate: 0, rotateDeg: 0, width: srcWidth, height: srcHeight, flipH: false, flipV: false, swapDimensions: false };
  }
}

/**
 * Applies the EXIF orientation transformation matrix directly to a CanvasRenderingContext2D.
 * 
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} orientation
 * @param {number} srcWidth
 * @param {number} srcHeight
 */
export function applyCanvasTransform(ctx, orientation, srcWidth, srcHeight) {
  switch (orientation) {
    case 2: // Horizontal flip
      ctx.translate(srcWidth, 0);
      ctx.scale(-1, 1);
      break;
    case 3: // 180 rotate
      ctx.translate(srcWidth, srcHeight);
      ctx.rotate(Math.PI);
      break;
    case 4: // Vertical flip
      ctx.translate(0, srcHeight);
      ctx.scale(1, -1);
      break;
    case 5: // Transpose
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6: // 90 CW (Standard mobile portrait)
      ctx.translate(srcHeight, 0);
      ctx.rotate(0.5 * Math.PI);
      break;
    case 7: // Transverse
      ctx.translate(srcHeight, srcWidth);
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(-1, 1);
      break;
    case 8: // 270 CW / 90 CCW
      ctx.translate(0, srcWidth);
      ctx.rotate(-0.5 * Math.PI);
      break;
    default:
      break;
  }
}

/**
 * Reads the stored (un-rotated) pixel size from a JPEG's SOF marker.
 *
 * @param {Blob} file
 * @returns {Promise<{ width: number, height: number } | null>} null when not a JPEG or no SOF found
 */
export async function readJpegSize(file) {
  if (!file || typeof file.slice !== 'function') return null;
  const view = new DataView(await file.slice(0, 1024 * 1024).arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

  let offset = 2;
  while (offset + 9 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xFF) { offset++; continue; } // fill byte
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === 0xD9 || marker === 0xDA) return null; // EOI / start of scan
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

/**
 * Parses EXIF date string ("YYYY:MM:DD HH:MM:SS") into a native JavaScript Date object.
 * 
 * @param {string} dateStr
 * @param {string} [offsetStr]
 * @returns {Date|null}
 */
export function parseExifDate(dateStr, offsetStr = null) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.replace(/\0/g, '').trim();
  // Check for unconfigured / zeroed camera clock
  if (/^0{4}[:\-\/]0{2}[:\-\/]0{2}/.test(trimmed)) return null;

  const match = trimmed.match(/^(\d{4})[:\-\/](\d{2})[:\-\/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([+-]\d{2}:?\d{2}|Z))?$/);
  if (!match) return null;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  const hh = parseInt(match[4], 10);
  const mm = parseInt(match[5], 10);
  const ss = parseInt(match[6], 10);
  const ms = match[7] ? parseInt(match[7].padEnd(3, '0').slice(0, 3), 10) : 0;
  const tz = match[8] || (offsetStr && typeof offsetStr === 'string' ? offsetStr.trim() : null);

  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;

  // Timezone aware date creation
  if (tz) {
    let normalizedTz = tz;
    if (normalizedTz !== 'Z' && !normalizedTz.includes(':') && normalizedTz.length === 5) {
      normalizedTz = normalizedTz.slice(0, 3) + ':' + normalizedTz.slice(3);
    }
    const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}${normalizedTz}`;
    const parsed = new Date(iso);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const date = new Date(y, m - 1, d, hh, mm, ss, ms);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Creates an empty metadata fallback result.
 */
function createEmptyResult() {
  return {
    hasExif: false,
    orientation: 1,
    dateTime: null,
    dateTimeOriginalStr: null,
    latitude: null,
    longitude: null,
    altitude: null,
    raw: {}
  };
}

/**
 * Locates the TIFF header within JPEG, PNG, or WebP DataView.
 */
function findTiffHeader(dv) {
  if (dv.byteLength < 4) return null;
  const sig = dv.getUint16(0, false);

  // 1. JPEG Container (0xFFD8)
  if (sig === 0xFFD8) {
    let offset = 2;
    while (offset + 4 <= dv.byteLength) {
      const marker = dv.getUint16(offset, false);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFDA || marker === 0xFFD9) break;

      const len = dv.getUint16(offset + 2, false);

      // APP1 Marker: 0xFFE1
      if (marker === 0xFFE1) {
        if (offset + 10 <= dv.byteLength) {
          const isExif = dv.getUint8(offset + 4) === 0x45 && // E
                         dv.getUint8(offset + 5) === 0x78 && // x
                         dv.getUint8(offset + 6) === 0x69 && // i
                         dv.getUint8(offset + 7) === 0x66 && // f
                         dv.getUint8(offset + 8) === 0x00 &&
                         dv.getUint8(offset + 9) === 0x00;
          if (isExif) {
            const tiffOffset = offset + 10;
            if (tiffOffset + 8 <= dv.byteLength) {
              const byteOrder = dv.getUint16(tiffOffset, false);
              const isLE = byteOrder === 0x4949; // 'II'
              if (isLE || byteOrder === 0x4D4D) { // 'MM'
                if (dv.getUint16(tiffOffset + 2, isLE) === 0x002A) {
                  return { tiffOffset, isLE };
                }
              }
            }
          }
        }
      }
      offset += 2 + len;
    }
    return null;
  }

  // 2. PNG Container (0x8950 0x4E47)
  if (sig === 0x8950 && dv.byteLength >= 8 && dv.getUint16(2, false) === 0x4E47) {
    let offset = 8;
    while (offset + 8 <= dv.byteLength) {
      const len = dv.getUint32(offset, false);
      const chunkType = String.fromCharCode(
        dv.getUint8(offset + 4), dv.getUint8(offset + 5),
        dv.getUint8(offset + 6), dv.getUint8(offset + 7)
      );
      if (chunkType === 'eXIf') {
        const tiffOffset = offset + 8;
        if (tiffOffset + 8 <= dv.byteLength) {
          const byteOrder = dv.getUint16(tiffOffset, false);
          const isLE = byteOrder === 0x4949;
          if ((isLE || byteOrder === 0x4D4D) && dv.getUint16(tiffOffset + 2, isLE) === 0x002A) {
            return { tiffOffset, isLE };
          }
        }
      }
      if (chunkType === 'IDAT' || chunkType === 'IEND') break;
      offset += 12 + len;
    }
    return null;
  }

  // 3. WebP Container (RIFF .... WEBP)
  if (sig === 0x5249 && dv.byteLength >= 12 && dv.getUint32(8, false) === 0x57454250) {
    let offset = 12;
    while (offset + 8 <= dv.byteLength) {
      const chunkType = String.fromCharCode(
        dv.getUint8(offset), dv.getUint8(offset + 1),
        dv.getUint8(offset + 2), dv.getUint8(offset + 3)
      );
      const len = dv.getUint32(offset + 4, true);
      if (chunkType === 'EXIF') {
        let tiffOffset = offset + 8;
        if (tiffOffset + 8 <= dv.byteLength) {
          if (dv.getUint32(tiffOffset, false) === 0x45786966) {
            tiffOffset += 6;
          }
          if (tiffOffset + 8 <= dv.byteLength) {
            const byteOrder = dv.getUint16(tiffOffset, false);
            const isLE = byteOrder === 0x4949;
            if ((isLE || byteOrder === 0x4D4D) && dv.getUint16(tiffOffset + 2, isLE) === 0x002A) {
              return { tiffOffset, isLE };
            }
          }
        }
      }
      offset += 8 + len + (len % 2);
    }
    return null;
  }

  // 4. HEIC / HEIF / AVIF / ISOBMFF Container (ftyp box signature at offset 4)
  if (dv.byteLength >= 12 && dv.getUint32(4, false) === 0x66747970) {
    const maxScan = Math.min(dv.byteLength - 8, 262144); // Scan header window up to 256KB
    for (let i = 0; i < maxScan; i++) {
      // Heuristic A: 'Exif\0\0' followed by TIFF header (Apple HEIC item payload)
      if (dv.getUint32(i, false) === 0x45786966 && dv.getUint16(i + 4, false) === 0x0000) {
        const cand = i + 6;
        if (cand + 8 <= dv.byteLength) {
          const bo = dv.getUint16(cand, false);
          const isLE = bo === 0x4949; // 'II'
          if ((isLE || bo === 0x4D4D) && dv.getUint16(cand + 2, isLE) === 0x002A) {
            return { tiffOffset: cand, isLE };
          }
        }
      }
      // Heuristic B: Standalone TIFF Header ('II*\0' or 'MM\0*') with valid IFD0 offset
      const bo = dv.getUint16(i, false);
      if (bo === 0x4949 || bo === 0x4D4D) {
        const isLE = bo === 0x4949;
        if (dv.getUint16(i + 2, isLE) === 0x002A) {
          const ifd0 = dv.getUint32(i + 4, isLE);
          if (ifd0 >= 8 && ifd0 < 65536 && i + ifd0 + 2 <= dv.byteLength) {
            const count = dv.getUint16(i + ifd0, isLE);
            if (count >= 1 && count <= 500) {
              return { tiffOffset: i, isLE };
            }
          }
        }
      }
    }
    return null;
  }

  return null;
}

/**
 * Parses TIFF directory structure.
 */
function parseTiff(dv, tiffStart, isLE) {
  let needsFull = false;
  const ifd0Offset = dv.getUint32(tiffStart + 4, isLE);

  const readTag = (entryOffset) => {
    if (entryOffset + 12 > dv.byteLength) return null;
    const tag = dv.getUint16(entryOffset, isLE);
    const type = dv.getUint16(entryOffset + 2, isLE);
    const count = dv.getUint32(entryOffset + 4, isLE);

    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const size = typeSizes[type] || 1;
    const totalBytes = size * count;

    let valOffset = entryOffset + 8;
    if (totalBytes > 4) {
      const relOffset = dv.getUint32(entryOffset + 8, isLE);
      valOffset = tiffStart + relOffset;
      if (valOffset + totalBytes > dv.byteLength) {
        needsFull = true;
        return null;
      }
    }

    // ASCII String (Type 2)
    if (type === 2) {
      let str = '';
      for (let i = 0; i < count; i++) {
        const c = dv.getUint8(valOffset + i);
        if (c === 0) break;
        str += String.fromCharCode(c);
      }
      return { tag, val: str.trim() };
    }

    // SHORT (Type 3)
    if (type === 3) {
      if (count === 1) return { tag, val: dv.getUint16(valOffset, isLE) };
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(dv.getUint16(valOffset + i * 2, isLE));
      return { tag, val: arr };
    }

    // LONG (Type 4)
    if (type === 4) {
      if (count === 1) return { tag, val: dv.getUint32(valOffset, isLE) };
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(dv.getUint32(valOffset + i * 4, isLE));
      return { tag, val: arr };
    }

    // RATIONAL (Type 5)
    if (type === 5) {
      const arr = [];
      for (let i = 0; i < count; i++) {
        const num = dv.getUint32(valOffset + i * 8, isLE);
        const den = dv.getUint32(valOffset + i * 8 + 4, isLE);
        arr.push(den === 0 ? 0 : num / den);
      }
      return { tag, val: count === 1 ? arr[0] : arr };
    }

    // BYTE (Type 1)
    if (type === 1) {
      if (count === 1) return { tag, val: dv.getUint8(valOffset) };
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(dv.getUint8(valOffset + i));
      return { tag, val: arr };
    }

    return null;
  };

  const visited = new Set();
  const readIFD = (relOffset) => {
    const tags = {};
    if (relOffset === 0 || visited.has(relOffset)) return tags;
    visited.add(relOffset);

    const absOffset = tiffStart + relOffset;
    if (absOffset + 2 > dv.byteLength) {
      needsFull = true;
      return tags;
    }

    const entryCount = dv.getUint16(absOffset, isLE);
    if (entryCount > 500) return tags;

    for (let i = 0; i < entryCount; i++) {
      const entryOffset = absOffset + 2 + i * 12;
      const res = readTag(entryOffset);
      if (res) tags[res.tag] = res.val;
    }
    return tags;
  };

  // Parse IFD0
  const ifd0 = readIFD(ifd0Offset);
  // Exif SubIFD (0x8769)
  const exifSub = ifd0[0x8769] ? readIFD(ifd0[0x8769]) : {};
  // GPS SubIFD (0x8825)
  const gpsSub = ifd0[0x8825] ? readIFD(ifd0[0x8825]) : {};

  // 1. Orientation
  const rawOrient = ifd0[0x0112];
  const orientation = (typeof rawOrient === 'number' && rawOrient >= 1 && rawOrient <= 8) ? rawOrient : 1;

  // 2. Datetime
  const dateStr = exifSub[0x9003] || exifSub[0x9004] || ifd0[0x0132] || null;
  const offsetStr = exifSub[0x9011] || exifSub[0x9010] || null;
  const dateTime = dateStr ? parseExifDate(dateStr, offsetStr) : null;

  // 3. GPS Coordinates & Altitude
  let latitude = null;
  let longitude = null;
  let altitude = null;

  if (gpsSub[0x0002] && Array.isArray(gpsSub[0x0002]) && gpsSub[0x0002].length >= 3) {
    latitude = dmsToDecimal(gpsSub[0x0002], gpsSub[0x0001]);
  }
  if (gpsSub[0x0004] && Array.isArray(gpsSub[0x0004]) && gpsSub[0x0004].length >= 3) {
    longitude = dmsToDecimal(gpsSub[0x0004], gpsSub[0x0003]);
  }
  if (typeof gpsSub[0x0006] === 'number') {
    const altRef = gpsSub[0x0005] === 1 ? -1 : 1;
    altitude = Number((gpsSub[0x0006] * altRef).toFixed(2));
  }

  return {
    hasExif: true,
    orientation,
    dateTime,
    dateTimeOriginalStr: dateStr,
    latitude,
    longitude,
    altitude,
    raw: { ifd0, exif: exifSub, gps: gpsSub },
    _needsFull: needsFull
  };
}

/**
 * Synchronously parses EXIF metadata from ArrayBuffer, DataView, or Uint8Array.
 * 
 * @param {ArrayBuffer|DataView|ArrayBufferView} bufferOrView
 * @returns {object}
 */
export function parseExifSync(bufferOrView) {
  if (!bufferOrView) return createEmptyResult();

  let dv;
  try {
    if (bufferOrView instanceof DataView) {
      dv = bufferOrView;
    } else if (bufferOrView instanceof ArrayBuffer) {
      dv = new DataView(bufferOrView);
    } else if (ArrayBuffer.isView(bufferOrView)) {
      dv = new DataView(bufferOrView.buffer, bufferOrView.byteOffset, bufferOrView.byteLength);
    } else {
      return createEmptyResult();
    }
  } catch {
    return createEmptyResult();
  }

  try {
    const tiffInfo = findTiffHeader(dv);
    if (!tiffInfo) return createEmptyResult();

    return parseTiff(dv, tiffInfo.tiffOffset, tiffInfo.isLE);
  } catch (err) {
    return createEmptyResult();
  }
}

/**
 * Main asynchronous EXIF parsing entrypoint.
 * Accepts File, Blob, ArrayBuffer, or ArrayBufferView.
 * 
 * @param {File|Blob|ArrayBuffer|ArrayBufferView} input
 * @returns {Promise<object>}
 */
export async function parseExif(input) {
  if (!input) return createEmptyResult();

  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    return parseExifSync(input);
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    try {
      // Slicing first 128 KB for instant mobile parsing
      const fastSlice = input.slice(0, 131072);
      const fastBuf = await fastSlice.arrayBuffer();
      const result = parseExifSync(fastBuf);

      if (result._needsFull && input.size > 131072) {
        const fullBuf = await input.arrayBuffer();
        const fullRes = parseExifSync(fullBuf);
        delete fullRes._needsFull;
        return fullRes;
      }

      delete result._needsFull;
      return result;
    } catch {
      return createEmptyResult();
    }
  }

  return createEmptyResult();
}

/**
 * ExifParser class wrapper matching static OOP and modular patterns.
 */
export class ExifParser {
  static parse(input) {
    return parseExif(input);
  }
  static parseSync(bufferOrView) {
    return parseExifSync(bufferOrView);
  }
  static parseGpsCoordinate(dms, ref) {
    return dmsToDecimal(dms, ref);
  }
  static parseDate(dateStr, offsetStr) {
    return parseExifDate(dateStr, offsetStr);
  }
  static getOrientationTransform(orientation, srcWidth, srcHeight) {
    return getOrientationTransform(orientation, srcWidth, srcHeight);
  }
  static applyCanvasTransform(ctx, orientation, srcWidth, srcHeight) {
    return applyCanvasTransform(ctx, orientation, srcWidth, srcHeight);
  }
  static createEmptyResult() {
    return createEmptyResult();
  }
}
