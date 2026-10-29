/**
 * geocoder.js
 * 
 * Dual-Tier Reverse Geocoding Engine for Timestamp Camera Web.
 * 
 * Features:
 * - Tier 1: Instant offline spatial lookup across all 77 Thai provinces + key districts (<0.002ms)
 * - Tier 2: Debounced (800ms) OpenStreetMap Nominatim reverse API enrichment with AbortController
 * - Thai administrative normalization (Bangkok vs Provincial formatting)
 * - Manual address edit protection (isAddressManual) and in-memory LRU cache
 * - Optional Google Geocoding provider when GOOGLE_GEOCODING_API_KEY is set in config.js
 */

import { GOOGLE_GEOCODING_API_KEY } from './config.js';

// Embedded Thai Spatial Index: [lat, lon, district, province, isBangkok]
export const THAI_SPATIAL_INDEX = [
  // --- Bangkok Metropolis & Central Region (18) ---
  [13.7500, 100.4914, 'เขตพระนคร', 'กรุงเทพมหานคร', 1],
  [13.5991, 100.5968, 'อ.เมืองสมุทรปราการ', 'จ.สมุทรปราการ', 0],
  [13.8591, 100.5217, 'อ.เมืองนนทบุรี', 'จ.นนทบุรี', 0],
  [14.0208, 100.5250, 'อ.เมืองปทุมธานี', 'จ.ปทุมธานี', 0],
  [14.3532, 100.5684, 'อ.พระนครศรีอยุธยา', 'จ.พระนครศรีอยุธยา', 0],
  [14.5896, 100.4550, 'อ.เมืองอ่างทอง', 'จ.อ่างทอง', 0],
  [14.7995, 100.6534, 'อ.เมืองลพบุรี', 'จ.ลพบุรี', 0],
  [14.8856, 100.4044, 'อ.เมืองสิงห์บุรี', 'จ.สิงห์บุรี', 0],
  [15.1852, 100.1252, 'อ.เมืองชัยนาท', 'จ.ชัยนาท', 0],
  [14.5289, 100.9108, 'อ.เมืองสระบุรี', 'จ.สระบุรี', 0],
  [13.3611, 100.9847, 'อ.เมืองชลบุรี', 'จ.ชลบุรี', 0],
  [12.6814, 101.2816, 'อ.เมืองระยอง', 'จ.ระยอง', 0],
  [12.6114, 102.1039, 'อ.เมืองจันทบุรี', 'จ.จันทบุรี', 0],
  [12.2428, 102.5175, 'อ.เมืองตราด', 'จ.ตราด', 0],
  [13.6904, 101.0780, 'อ.เมืองฉะเชิงเทรา', 'จ.ฉะเชิงเทรา', 0],
  [14.0510, 101.3734, 'อ.เมืองปราจีนบุรี', 'จ.ปราจีนบุรี', 0],
  [14.2069, 101.2131, 'อ.เมืองนครนายก', 'จ.นครนายก', 0],
  [13.8140, 102.0583, 'อ.เมืองสระแก้ว', 'จ.สระแก้ว', 0],

  // --- Northern Region (17) ---
  [18.7883, 98.9853, 'อ.เมืองเชียงใหม่', 'จ.เชียงใหม่', 0],
  [18.5744, 99.0087, 'อ.เมืองลำพูน', 'จ.ลำพูน', 0],
  [18.2888, 99.4928, 'อ.เมืองลำปาง', 'จ.ลำปาง', 0],
  [17.6256, 100.0993, 'อ.เมืองอุตรดิตถ์', 'จ.อุตรดิตถ์', 0],
  [18.1446, 100.1410, 'อ.เมืองแพร่', 'จ.แพร่', 0],
  [18.7756, 100.7730, 'อ.เมืองน่าน', 'จ.น่าน', 0],
  [19.1664, 99.9022, 'อ.เมืองพะเยา', 'จ.พะเยา', 0],
  [19.9072, 99.8325, 'อ.เมืองเชียงราย', 'จ.เชียงราย', 0],
  [19.3021, 97.9654, 'อ.เมืองแม่ฮ่องสอน', 'จ.แม่ฮ่องสอน', 0],
  [15.7057, 100.1378, 'อ.เมืองนครสวรรค์', 'จ.นครสวรรค์', 0],
  [15.3835, 100.0246, 'อ.เมืองอุทัยธานี', 'จ.อุทัยธานี', 0],
  [16.4834, 99.5227, 'อ.เมืองกำแพงเพชร', 'จ.กำแพงเพชร', 0],
  [16.8839, 99.1258, 'อ.เมืองตาก', 'จ.ตาก', 0],
  [17.0078, 99.8234, 'อ.เมืองสุโขทัย', 'จ.สุโขทัย', 0],
  [16.8211, 100.2659, 'อ.เมืองพิษณุโลก', 'จ.พิษณุโลก', 0],
  [16.4429, 100.3488, 'อ.เมืองพิจิตร', 'จ.พิจิตร', 0],
  [16.4190, 101.1567, 'อ.เมืองเพชรบูรณ์', 'จ.เพชรบูรณ์', 0],

  // --- Northeastern Region / Isan (20) ---
  [14.9739, 102.1039, 'อ.เมืองนครราชสีมา', 'จ.นครราชสีมา', 0],
  [14.9930, 103.1029, 'อ.เมืองบุรีรัมย์', 'จ.บุรีรัมย์', 0],
  [14.8818, 103.4936, 'อ.เมืองสุรินทร์', 'จ.สุรินทร์', 0],
  [15.1186, 104.3220, 'อ.เมืองศรีสะเกษ', 'จ.ศรีสะเกษ', 0],
  [15.2287, 104.8564, 'อ.เมืองอุบลราชธานี', 'จ.อุบลราชธานี', 0],
  [15.7926, 104.1451, 'อ.เมืองยโสธร', 'จ.ยโสธร', 0],
  [15.8063, 102.0315, 'อ.เมืองชัยภูมิ', 'จ.ชัยภูมิ', 0],
  [15.8657, 104.6258, 'อ.เมืองอำนาจเจริญ', 'จ.อำนาจเจริญ', 0],
  [18.3633, 103.6528, 'อ.เมืองบึงกาฬ', 'จ.บึงกาฬ', 0],
  [17.2034, 102.4407, 'อ.เมืองหนองบัวลำภู', 'จ.หนองบัวลำภู', 0],
  [16.4419, 102.8359, 'อ.เมืองขอนแก่น', 'จ.ขอนแก่น', 0],
  [17.4138, 102.7872, 'อ.เมืองอุดรธานี', 'จ.อุดรธานี', 0],
  [17.4860, 101.7223, 'อ.เมืองเลย', 'จ.เลย', 0],
  [17.8783, 102.7420, 'อ.เมืองหนองคาย', 'จ.หนองคาย', 0],
  [16.1852, 103.3007, 'อ.เมืองมหาสารคาม', 'จ.มหาสารคาม', 0],
  [16.0538, 103.6520, 'อ.เมืองร้อยเอ็ด', 'จ.ร้อยเอ็ด', 0],
  [16.4322, 103.5061, 'อ.เมืองกาฬสินธุ์', 'จ.กาฬสินธุ์', 0],
  [17.1612, 104.1486, 'อ.เมืองสกลนคร', 'จ.สกลนคร', 0],
  [17.3998, 104.7801, 'อ.เมืองนครพนม', 'จ.นครพนม', 0],
  [16.5436, 104.7235, 'อ.เมืองมุกดาหาร', 'จ.มุกดาหาร', 0],

  // --- Western Region (8) ---
  [14.4745, 100.1177, 'อ.เมืองสุพรรณบุรี', 'จ.สุพรรณบุรี', 0],
  [13.8196, 100.0601, 'อ.เมืองนครปฐม', 'จ.นครปฐม', 0],
  [13.5475, 100.2744, 'อ.เมืองสมุทรสาคร', 'จ.สมุทรสาคร', 0],
  [13.4098, 100.0023, 'อ.เมืองสมุทรสงคราม', 'จ.สมุทรสงคราม', 0],
  [14.0228, 99.5328, 'อ.เมืองกาญจนบุรี', 'จ.กาญจนบุรี', 0],
  [13.5283, 99.8134, 'อ.เมืองราชบุรี', 'จ.ราชบุรี', 0],
  [13.1114, 99.9391, 'อ.เมืองเพชรบุรี', 'จ.เพชรบุรี', 0],
  [11.8124, 99.7972, 'อ.เมืองประจวบคีรีขันธ์', 'จ.ประจวบคีรีขันธ์', 0],

  // --- Southern Region (14) ---
  [8.4304, 99.9631, 'อ.เมืองนครศรีธรรมราช', 'จ.นครศรีธรรมราช', 0],
  [8.0863, 98.9063, 'อ.เมืองกระบี่', 'จ.กระบี่', 0],
  [8.4509, 98.5255, 'อ.เมืองพังงา', 'จ.พังงา', 0],
  [7.8804, 98.3923, 'อ.เมืองภูเก็ต', 'จ.ภูเก็ต', 0],
  [9.1382, 99.3217, 'อ.เมืองสุราษฎร์ธานี', 'จ.สุราษฎร์ธานี', 0],
  [9.9658, 98.6348, 'อ.เมืองระนอง', 'จ.ระนอง', 0],
  [10.4930, 99.1800, 'อ.เมืองชุมพร', 'จ.ชุมพร', 0],
  [7.1756, 100.6143, 'อ.เมืองสงขลา', 'จ.สงขลา', 0],
  [6.6238, 100.0674, 'อ.เมืองสตูล', 'จ.สตูล', 0],
  [7.5563, 99.6114, 'อ.เมืองตรัง', 'จ.ตรัง', 0],
  [7.6167, 100.0740, 'อ.เมืองพัทลุง', 'จ.พัทลุง', 0],
  [6.8675, 101.2501, 'อ.เมืองปัตตานี', 'จ.ปัตตานี', 0],
  [6.5411, 101.2813, 'อ.เมืองยะลา', 'จ.ยะลา', 0],
  [6.4255, 101.8253, 'อ.เมืองนราธิวาส', 'จ.นราธิวาส', 0],

  // --- Major Non-Mueang Economic, Border & Tourist Districts (13) ---
  [5.7743, 101.0712, 'อ.เบตง', 'จ.ยะลา', 0],
  [7.0083, 100.4767, 'อ.หาดใหญ่', 'จ.สงขลา', 0],
  [12.9276, 100.8771, 'อ.บางละมุง', 'จ.ชลบุรี', 0],
  [12.5684, 99.9577, 'อ.หัวหิน', 'จ.ประจวบคีรีขันธ์', 0],
  [12.7997, 99.9694, 'อ.ชะอำ', 'จ.เพชรบุรี', 0],
  [9.5120, 100.0136, 'อ.เกาะสมุย', 'จ.สุราษฎร์ธานี', 0],
  [9.7500, 100.0333, 'อ.เกาะพะงัน', 'จ.สุราษฎร์ธานี', 0],
  [16.7167, 98.5667, 'อ.แม่สอด', 'จ.ตาก', 0],
  [20.4333, 99.8833, 'อ.แม่สาย', 'จ.เชียงราย', 0],
  [19.9167, 99.2167, 'อ.ฝาง', 'จ.เชียงใหม่', 0],
  [19.3586, 98.4415, 'อ.ปาย', 'จ.แม่ฮ่องสอน', 0],
  [18.4167, 98.6833, 'อ.จอมทอง', 'จ.เชียงใหม่', 0],
  [13.7258, 100.5283, 'เขตบางรัก', 'กรุงเทพมหานคร', 1],
  [13.8286, 100.5599, 'เขตจตุจักร', 'กรุงเทพมหานคร', 1]
];

// Module-level cache & debounce controllers
const addressCache = new Map();
const MAX_CACHE_SIZE = 200;
let debounceTimer = null;
let activeAbortController = null;
let pendingResolvers = [];

/**
 * Normalizes district and province into standard Thai administrative address string.
 * Bangkok: "เขตพระนคร, กรุงเทพมหานคร"
 * Pattaya: "เมืองพัทยา, จ.ชลบุรี"
 * Provinces: "อ.เมืองยะลา, จ.ยะลา"
 * 
 * @param {string} district
 * @param {string} province
 * @returns {string}
 */
export function formatThaiAddress(district, province) {
  const dStr = (district || '').trim();
  const pStr = (province || '').trim();

  // Bangkok Special Administrative Area
  if (pStr === 'กรุงเทพมหานคร' || pStr === 'จังหวัดกรุงเทพมหานคร') {
    let cleanD = dStr.replace(/^เขต\s*/, '');
    cleanD = cleanD ? `เขต${cleanD}` : '';
    return cleanD ? `${cleanD}, กรุงเทพมหานคร` : 'กรุงเทพมหานคร';
  }

  // Pattaya Special City
  if (dStr.includes('เมืองพัทยา')) {
    let cleanP = pStr.replace(/^จังหวัด\s*/, '').replace(/^จ\.\s*/, '');
    cleanP = cleanP ? `จ.${cleanP}` : '';
    return cleanP ? `เมืองพัทยา, ${cleanP}` : 'เมืองพัทยา';
  }

  // Standard Provinces
  let cleanD = dStr.replace(/^อำเภอ\s*/, '').replace(/^อ\.\s*/, '');
  if (cleanD) {
    if (!cleanD.startsWith('กิ่งอำเภอ')) {
      cleanD = `อ.${cleanD}`;
    }
  }

  let cleanP = pStr.replace(/^จังหวัด\s*/, '').replace(/^จ\.\s*/, '');
  if (cleanP) {
    cleanP = `จ.${cleanP}`;
  }

  if (cleanD && cleanP) return `${cleanD}, ${cleanP}`;
  if (cleanP) return cleanP;
  if (cleanD) return cleanD;
  return '';
}

/**
 * Tier 1: Instant local spatial nearest-neighbor lookup across Thai provinces.
 * Executes in < 0.002ms offline.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string} Formatted Thai address e.g. "อ.เมืองยะลา, จ.ยะลา" or "" if out of bounds
 */
export function lookupOfflineAddress(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return '';
  }

  // Fast bounding box reject for coordinates outside Thailand
  if (lat < 5.0 || lat > 21.0 || lon < 97.0 || lon > 106.0) {
    return '';
  }

  let minDistanceSq = Infinity;
  let nearestAddress = '';
  const cosLat = Math.cos((lat * Math.PI) / 180);

  for (let i = 0; i < THAI_SPATIAL_INDEX.length; i++) {
    const [pLat, pLon, district, province, isBangkok] = THAI_SPATIAL_INDEX[i];
    const dLat = pLat - lat;
    const dLon = (pLon - lon) * cosLat;
    const distSq = dLat * dLat + dLon * dLon;

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      nearestAddress = isBangkok ? `${district}, กรุงเทพมหานคร` : `${district}, ${province}`;
    }
  }

  return nearestAddress;
}

/**
 * Normalizes OpenStreetMap Nominatim address object into strict reference format.
 * @param {Object} addr - Nominatim address payload
 * @returns {string|null} Normalized address or null
 */
export function parseNominatimAddress(addr) {
  if (!addr || typeof addr !== 'object') return null;

  // 1. Bangkok Special Administrative Area
  const isBangkok = (
    addr.province === 'จังหวัดกรุงเทพมหานคร' ||
    addr.province === 'กรุงเทพมหานคร' ||
    addr.city === 'กรุงเทพมหานคร' ||
    addr.state === 'กรุงเทพมหานคร' ||
    addr['ISO3166-2-lvl4'] === 'TH-10'
  );

  if (isBangkok) {
    const khet = addr.suburb || addr.city_district || addr.district || addr.borough || addr.quarter || '';
    if (khet) {
      const cleanKhet = khet.startsWith('เขต') ? khet : `เขต${khet}`;
      return `${cleanKhet}, กรุงเทพมหานคร`;
    }
    return 'กรุงเทพมหานคร';
  }

  // 2. Provincial Thailand
  let district = addr.county || addr.district || addr.city_district || addr.town || addr.municipality || '';
  let province = addr.province || addr.state || '';

  if (district || province) {
    return formatThaiAddress(district, province);
  }

  // Fallback for international locations
  if (addr.city && addr.country) return `${addr.city}, ${addr.country}`;
  return addr.city || addr.town || addr.country || '';
}

/**
 * Normalizes a Google Geocoding API result list into the reference format.
 * Thai results: administrative_area_level_2 = อำเภอ/เขต, administrative_area_level_1 = จังหวัด.
 * @param {Array<Object>} results - Google `results` array
 * @returns {string|null}
 */
export function parseGoogleGeocodeResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const pick = (type) => {
    for (const result of results) {
      const comp = (result.address_components || []).find(c => (c.types || []).includes(type));
      if (comp) return comp.long_name;
    }
    return '';
  };

  const province = pick('administrative_area_level_1');
  const isBangkok = province.includes('กรุงเทพ');
  const district = isBangkok
    ? (pick('sublocality_level_1') || pick('administrative_area_level_2'))
    : pick('administrative_area_level_2');

  if (district || province) {
    return formatThaiAddress(district, isBangkok ? 'กรุงเทพมหานคร' : province);
  }
  return results[0].formatted_address || null;
}

/**
 * Tier 2 (Google): Reverse geocode with Google Geocoding API. Requires an API key.
 * @returns {Promise<string|null>}
 */
export async function fetchGoogleAddress(lat, lon, apiKey, signal) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=th&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status !== 'OK') {
      console.warn('Google geocode status:', data.status, data.error_message || '');
      return null;
    }
    return parseGoogleGeocodeResults(data.results);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('Google reverse lookup failed:', err.message);
    }
    return null;
  }
}

/**
 * Returns which online provider will be used: 'google' when an API key is configured, else 'nominatim'.
 */
export function getOnlineProvider() {
  return GOOGLE_GEOCODING_API_KEY ? 'google' : 'nominatim';
}

/**
 * Tier 2: Fetches reverse geocoded address online (Google if configured, Nominatim otherwise).
 * Falls back to Nominatim if the Google request fails.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<string|null>} Formatted address or null
 */
export async function fetchOnlineAddress(lat, lon, signal) {
  if (GOOGLE_GEOCODING_API_KEY) {
    const googleAddress = await fetchGoogleAddress(lat, lon, GOOGLE_GEOCODING_API_KEY, signal);
    if (googleAddress || signal?.aborted) return googleAddress;
  }
  return fetchNominatimAddress(lat, lon, signal);
}

/**
 * Tier 2 (Nominatim): Fetches reverse geocoded address from OpenStreetMap Nominatim.
 * @returns {Promise<string|null>}
 */
export async function fetchNominatimAddress(lat, lon, signal) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=th`;
    const response = await fetch(url, {
      signal,
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) return null;
    const data = await response.json();
    return parseNominatimAddress(data?.address);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('Nominatim reverse lookup failed:', err.message);
    }
    return null;
  }
}

/**
 * Public Orchestrator: Dual-Tier Address Resolution
 * Instantly calls onUpdate with Tier 1 offline result, then enriches with Tier 2 Nominatim.
 * 
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Object} [options]
 * @param {boolean} [options.isAddressManual=false] - If true, skips updating address to protect user edits
 * @param {Function} [options.onUpdate] - Callback receiving address updates (offline immediately, online later)
 * @returns {Promise<string>} Final resolved address
 */
export function resolveThaiAddress(lat, lon, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};

  // Guard coordinate types: lat and lon must be finite numbers
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Promise.resolve('');
  }

  // Reject coordinates outside valid WGS-84 ranges [-90, 90] and [-180, 180]
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Promise.resolve('');
  }

  // If user locked manual address, do not overwrite
  if (opts.isAddressManual) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    while (pendingResolvers.length > 0) {
      const item = pendingResolvers.shift();
      item.resolve(item.fallback);
    }
    return Promise.resolve('');
  }

  // Step 1: Immediate offline resolution
  const offlineAddress = lookupOfflineAddress(lat, lon);
  if (offlineAddress && typeof opts.onUpdate === 'function') {
    opts.onUpdate(offlineAddress, { source: 'offline' });
  }

  // Step 2: Check in-memory cache (4-decimal precision key ~11m)
  const normLat = Math.abs(lat) < 1e-7 ? 0 : lat;
  const normLon = Math.abs(lon) < 1e-7 ? 0 : lon;
  const cacheKey = `${normLat.toFixed(4)},${normLon.toFixed(4)}`;
  if (addressCache.has(cacheKey)) {
    const cached = addressCache.get(cacheKey);
    if (typeof opts.onUpdate === 'function') {
      opts.onUpdate(cached, { source: getOnlineProvider() });
    }
    return Promise.resolve(cached);
  }

  // Cancel prior pending debounce timer and in-flight fetch
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  // Settle any superseded pending promises immediately with their respective offline fallback
  while (pendingResolvers.length > 0) {
    const item = pendingResolvers.shift();
    item.resolve(item.fallback);
  }

  // If browser is offline, return offline result immediately
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.resolve(offlineAddress);
  }

  // Step 3: Debounced online fetch (800ms)
  return new Promise((resolve) => {
    pendingResolvers.push({ resolve, fallback: offlineAddress });

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const currentResolvers = pendingResolvers;
      pendingResolvers = [];

      activeAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      try {
        const onlineAddress = await fetchOnlineAddress(lat, lon, activeAbortController?.signal);
        const finalAddress = onlineAddress || offlineAddress;
        if (onlineAddress) {
          addressCache.set(cacheKey, onlineAddress);
          if (addressCache.size > MAX_CACHE_SIZE) {
            const firstKey = addressCache.keys().next().value;
            addressCache.delete(firstKey);
          }

          if (typeof opts.onUpdate === 'function') {
            opts.onUpdate(onlineAddress, { source: getOnlineProvider() });
          }
        }
        for (const item of currentResolvers) {
          item.resolve(finalAddress);
        }
      } catch (err) {
        for (const item of currentResolvers) {
          item.resolve(item.fallback);
        }
      } finally {
        activeAbortController = null;
      }
    }, 800);
  });
}

/**
 * Cache management utilities
 */
export function clearAddressCache() {
  addressCache.clear();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  while (pendingResolvers.length > 0) {
    const item = pendingResolvers.shift();
    item.resolve(item.fallback);
  }
}

export function getAddressCacheSize() {
  return addressCache.size;
}
