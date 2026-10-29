/**
 * coordinates.js
 * 
 * GPS Coordinate Engine for Timestamp Camera Web.
 * Formats coordinates matching the reference watermark standard: "+6.499413,+101.267206"
 * Provides boundary validation, coordinate pair parsing, DMS parsing, and Universal Map Link extraction.
 */

/**
 * Validates whether latitude and longitude are finite numbers within valid WGS84 ranges:
 * - Latitude: [-90, 90]
 * - Longitude: [-180, 180]
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function isValidCoordinate(lat, lon) {
  return typeof lat === 'number' &&
         typeof lon === 'number' &&
         Number.isFinite(lat) &&
         Number.isFinite(lon) &&
         lat >= -90 && lat <= 90 &&
         lon >= -180 && lon <= 180;
}

/**
 * Format a single numeric coordinate component with explicit sign and 6 decimal places.
 * Prevents "-0.000000" edge cases.
 *
 * @param {number} val
 * @returns {string} e.g. "+6.499413" or "-77.042793"
 */
export function formatSignedComponent(val) {
  const fixed = Math.abs(val).toFixed(6);
  if (fixed === '0.000000') return '+0.000000';
  return val >= 0 ? `+${fixed}` : `-${fixed}`;
}

/**
 * Format decimal coordinates to strict reference watermark standard:
 * "+latitude,+longitude" with explicit signs, 6 decimal places, and no space after comma.
 * Matches reference exact format: "+6.499413,+101.267206"
 *
 * @param {number} lat - Latitude in degrees (-90 to 90)
 * @param {number} lon - Longitude in degrees (-180 to 180)
 * @returns {string} Formatted coordinate string or empty string if invalid
 */
export function formatCoordinates(lat, lon) {
  if (!isValidCoordinate(lat, lon)) return '';
  return `${formatSignedComponent(lat)},${formatSignedComponent(lon)}`;
}

/**
 * Parses a decimal coordinate pair string in various spacing and sign formats:
 * - "+6.499413,+101.267206" (reference format)
 * - "6.499413, 101.267206" (comma + space)
 * - "6.499413,101.267206" (comma no space)
 * - "6.499413 101.267206" (whitespace separated)
 * - "-33.8688; +151.2093" (semicolon separated)
 *
 * @param {string} str
 * @returns {{ lat: number, lon: number } | null}
 */
export function parseCoordinatePair(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?)[,\s;/|]+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (!isValidCoordinate(lat, lon)) return null;

  return {
    lat: parseFloat(lat.toFixed(6)),
    lon: parseFloat(lon.toFixed(6))
  };
}

/**
 * Parses Degrees Minutes Seconds (DMS) notation into decimal coordinates.
 * Handles:
 * - 6°29'57.9"N 101°16'01.9"E
 * - 6° 29' 57.9" N, 101° 16' 01.9" E
 * - 12°20'00"S 77°01'00"W
 * - 6 29 57.9 N, 101 16 01.9 E
 *
 * @param {string} str
 * @returns {{ lat: number, lon: number } | null}
 */
export function parseDMS(str) {
  if (!str || typeof str !== 'string') return null;
  const regex = /([0-9.]+)[°ºd\s]+([0-9.]+)(?:['′m\s]+([0-9.]+))?["″s\s]*([NSns])[,;\s]+([0-9.]+)[°ºd\s]+([0-9.]+)(?:['′m\s]+([0-9.]+))?["″s\s]*([EWew])/i;
  const match = str.match(regex);
  if (!match) return null;

  const latDeg = parseFloat(match[1]);
  const latMin = parseFloat(match[2]);
  const latSec = match[3] !== undefined ? parseFloat(match[3]) : 0;
  const latDir = match[4].toUpperCase();
  let lat = latDeg + latMin / 60 + latSec / 3600;
  if (latDir === 'S') lat = -lat;

  const lonDeg = parseFloat(match[5]);
  const lonMin = parseFloat(match[6]);
  const lonSec = match[7] !== undefined ? parseFloat(match[7]) : 0;
  const lonDir = match[8].toUpperCase();
  let lon = lonDeg + lonMin / 60 + lonSec / 3600;
  if (lonDir === 'W') lon = -lon;

  if (!isValidCoordinate(lat, lon)) return null;

  return {
    lat: parseFloat(lat.toFixed(6)),
    lon: parseFloat(lon.toFixed(6))
  };
}

/**
 * Detects whether a URL is a shortened mobile Google Maps URL.
 * @param {string} str
 * @returns {boolean}
 */
export function isShortMapUrl(str) {
  if (!str || typeof str !== 'string') return false;
  return /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(str.trim());
}

/**
 * Universal Map Link Parser.
 * Extracts latitude and longitude from:
 * 1. Google Maps URLs:
 *    - /@lat,lon,zoom
 *    - /place/.../@lat,lon,zoom
 *    - Desktop data params: !3d<lat>!4d<lon>
 *    - Query params: ?q=lat,lon, ?query=lat,lon, ?ll=lat,lon, ?center=lat,lon
 * 2. Apple Maps URLs:
 *    - ?ll=lat,lon or ?q=lat,lon
 * 3. OpenStreetMap URLs:
 *    - Hash format: #map=zoom/lat/lon
 *    - Query format: ?lat=...&lon=...
 * 4. Geo URI Scheme:
 *    - geo:lat,lon
 *
 * @param {string} url
 * @returns {{ lat: number, lon: number } | null}
 */
export function parseMapUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Clean surrounding whitespace and quotation/angle bracket wrappers
  let str = url.trim().replace(/^<|>$/g, '').replace(/^"|"$/g, '');

  // 1. Google Maps /@lat,lon
  const atMatch = str.match(/@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lon = parseFloat(atMatch[2]);
    if (isValidCoordinate(lat, lon)) {
      return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
    }
  }

  // 2. Google Maps desktop !3dlat!4dlon in data param
  const dataMatch = str.match(/!3d([+-]?\d+(?:\.\d+)?)[^!]*!4d([+-]?\d+(?:\.\d+)?)/);
  if (dataMatch) {
    const lat = parseFloat(dataMatch[1]);
    const lon = parseFloat(dataMatch[2]);
    if (isValidCoordinate(lat, lon)) {
      return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
    }
  }

  // 3. Query params: ?q=lat,lon or ?query=lat,lon or ?ll=lat,lon or ?center=lat,lon
  // Handles %2C, comma, or spaces
  const queryMatch = str.match(/[?&](?:q|query|ll|center)=(?:loc:)?([+-]?\d+(?:\.\d+)?)(?:,|%2C|\+|\s)+([+-]?\d+(?:\.\d+)?)/i);
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lon = parseFloat(queryMatch[2]);
    if (isValidCoordinate(lat, lon)) {
      return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
    }
  }

  // 4. OpenStreetMap hash #map=zoom/lat/lon
  const osmHashMatch = str.match(/#map=\d+\/([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)/i);
  if (osmHashMatch) {
    const lat = parseFloat(osmHashMatch[1]);
    const lon = parseFloat(osmHashMatch[2]);
    if (isValidCoordinate(lat, lon)) {
      return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
    }
  }

  // 5. OpenStreetMap query params ?lat=...&lon=...
  const osmLonMatch = str.match(/[?&]lat=([+-]?\d+(?:\.\d+)?)&lon=([+-]?\d+(?:\.\d+)?)/i);
  if (osmLonMatch) {
    const lat = parseFloat(osmLonMatch[1]);
    const lon = parseFloat(osmLonMatch[2]);
    if (isValidCoordinate(lat, lon)) {
      return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
    }
  }

  // 6. Geo URI scheme: geo:lat,lon
  const geoMatch = str.match(/^geo:([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/i);
  if (geoMatch) {
    const lat = parseFloat(geoMatch[1]);
    const lon = parseFloat(geoMatch[2]);
    if (isValidCoordinate(lat, lon)) {
      return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
    }
  }

  return null;
}

/**
 * Universal Location Input Parser.
 * High-level router that parses any user input string:
 * 1. Tries parseMapUrl
 * 2. Tries parseCoordinatePair
 * 3. Tries parseDMS
 *
 * @param {string} input - User pasted URL or coordinate string
 * @returns {{ lat: number, lon: number } | null}
 */
export function parseLocationInput(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim();

  // Try Map URL first
  const urlRes = parseMapUrl(str);
  if (urlRes) return urlRes;

  // Try Coordinate Pair next
  const pairRes = parseCoordinatePair(str);
  if (pairRes) return pairRes;

  // Try DMS notation next
  const dmsRes = parseDMS(str);
  if (dmsRes) return dmsRes;

  return null;
}
