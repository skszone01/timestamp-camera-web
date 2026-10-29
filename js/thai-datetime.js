/**
 * thai-datetime.js
 * 
 * Core Thai Buddhist Era Datetime Engine for Timestamp Camera Web.
 * Formats timestamps matching the reference watermark standard: "28 ต.ค. 2569 21:12:07"
 * Provides calendar validation, leap year support, and HTML5 datetime-local conversions.
 */

/**
 * Standard 12 Thai month abbreviations with trailing dot.
 * Index 0 = January (ม.ค.), Index 11 = December (ธ.ค.)
 */
export const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

/**
 * Standard 12 Thai full month names.
 */
export const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/**
 * Checks whether an object is a valid JavaScript Date with a finite timestamp.
 * @param {any} val
 * @returns {boolean}
 */
export function isValidDate(val) {
  return val instanceof Date && !isNaN(val.getTime());
}

/**
 * Coerces an input (Date, number timestamp, or date string) into a valid Date object.
 * Returns null if coercion fails.
 * @param {any} input
 * @returns {Date|null}
 */
export function toValidDate(input) {
  if (input === undefined || input === null) return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }
  const coerced = new Date(input);
  return isNaN(coerced.getTime()) ? null : coerced;
}

/**
 * Format a Date into Thai Buddhist Era watermark format.
 * Matches reference exact format: "28 ต.ค. 2569 21:12:07" or "1 ม.ค. 2570 00:00:00"
 *
 * Algorithm:
 * - Day: Standard Thai format (single digit if < 10, or zero-padded if options.padDay is true)
 * - Month: Thai abbreviation with trailing dot (ม.ค. - ธ.ค.)
 * - Year: Buddhist Era (BE = CE + 543)
 * - Time: 24-hour zero-padded "HH:mm:ss"
 *
 * @param {Date|number|string} [date=new Date()] - Date to format
 * @param {object} [options={}] - Formatting options
 * @param {boolean} [options.padDay=false] - Whether day is zero-padded 2-digit (true = '05', false = '5')
 * @returns {string} Formatted Thai Buddhist date string or empty string if date is invalid
 */
export function formatThaiBuddhistDate(date = new Date(), options = {}) {
  const d = toValidDate(date);
  if (!d) return '';

  const padDay = options && options.padDay === true;
  const dayStr = padDay ? String(d.getDate()).padStart(2, '0') : String(d.getDate());
  const monthStr = THAI_MONTHS_SHORT[d.getMonth()];
  const beYear = d.getFullYear() + 543;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${dayStr} ${monthStr} ${beYear} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format only the date portion in Thai Buddhist format.
 * @param {Date|number|string} [date=new Date()]
 * @param {object} [options={}]
 * @param {boolean} [options.padDay=false]
 * @returns {string} e.g. "28 ต.ค. 2569" or "1 ม.ค. 2570"
 */
export function formatThaiDateOnly(date = new Date(), options = {}) {
  const d = toValidDate(date);
  if (!d) return '';
  const padDay = options && options.padDay === true;
  const dayStr = padDay ? String(d.getDate()).padStart(2, '0') : String(d.getDate());
  const monthStr = THAI_MONTHS_SHORT[d.getMonth()];
  const beYear = d.getFullYear() + 543;
  return `${dayStr} ${monthStr} ${beYear}`;
}

/**
 * Format only the time portion in 24-hour zero-padded format.
 * @param {Date|number|string} [date=new Date()]
 * @returns {string} e.g. "21:12:07"
 */
export function formatTimeOnly(date = new Date()) {
  const d = toValidDate(date);
  if (!d) return '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Parses a Thai Buddhist Era date string back into a JavaScript Date object.
 * Supports:
 * - "28 ต.ค. 2569 21:12:07"
 * - "1 ม.ค. 2570 00:00:00"
 * - "05 ม.ค. 2569 09:05:01"
 * - "5 ม.ค. 2569 09:05" (seconds optional)
 *
 * Strict calendar validation:
 * - Checks month abbreviations
 * - Converts BE to CE (CE = BE - 543)
 * - Validates month boundaries (rejects 31 เม.ย., 29 ก.พ. in non-leap years)
 * - Validates time boundaries (hours 0-23, minutes 0-59, seconds 0-59)
 *
 * @param {string} str - Thai date string to parse
 * @returns {Date|null} Parsed Date object or null if invalid
 */
export function parseThaiBuddhistDate(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  const match = trimmed.match(/^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;

  const [_, dStr, mStr, yStr, hhStr, mmStr, ssStr] = match;
  const monthIndex = THAI_MONTHS_SHORT.indexOf(mStr);
  if (monthIndex === -1) return null;

  const beYear = parseInt(yStr, 10);
  const ceYear = beYear - 543;
  const day = parseInt(dStr, 10);
  const hours = parseInt(hhStr, 10);
  const minutes = parseInt(mmStr, 10);
  const seconds = ssStr !== undefined ? parseInt(ssStr, 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  const result = new Date(ceYear, monthIndex, day, hours, minutes, seconds);
  // Strict calendar sanity check: verify rollover didn't alter month or day
  if (result.getFullYear() !== ceYear || result.getMonth() !== monthIndex || result.getDate() !== day) {
    return null;
  }

  return result;
}

/**
 * Converts a Date object to an HTML5 datetime-local compatible string.
 * Format: "YYYY-MM-DDTHH:mm:ss"
 * Note: Uses local wall-clock components, avoiding UTC timezone shifts.
 *
 * @param {Date|number|string} date
 * @returns {string} "YYYY-MM-DDTHH:mm:ss" or empty string if invalid
 */
export function toDatetimeLocalString(date) {
  const d = toValidDate(date);
  if (!d) return '';

  const pad = (n) => String(n).padStart(2, '0');
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());

  return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
}

/**
 * Parses an HTML5 datetime-local string ("YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DDTHH:mm")
 * into a local JavaScript Date object.
 *
 * @param {string} str
 * @returns {Date|null}
 */
export function fromDatetimeLocalString(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const [_, yStr, mStr, dStr, hhStr, mmStr, ssStr] = match;
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const hours = parseInt(hhStr, 10);
  const minutes = parseInt(mmStr, 10);
  const seconds = ssStr !== undefined ? parseInt(ssStr, 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  const result = new Date(year, month, day, hours, minutes, seconds);
  if (result.getFullYear() !== year || result.getMonth() !== month || result.getDate() !== day) {
    return null;
  }

  return result;
}
