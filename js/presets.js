/**
 * presets.js
 * 
 * Location Presets and LocalStorage Management for Timestamp Camera Web.
 * 
 * Features:
 * - Built-in presets list (DEFAULT_PRESETS, edited by the site owner; empty by default)
 * - LocalStorage CRUD operations for user custom presets
 * - Schema validation and bounds checking
 * - Graceful fallback if localStorage is disabled, throws QuotaExceededError, or is unavailable
 */

/** จำนวนช่องพิกัดที่แสดงในรายการ "พิกัดที่บันทึกไว้" (ช่องที่ยังไม่มีพิกัดจะแสดงเป็นช่องว่าง) */
export const PRESET_SLOT_COUNT = 10;

/**
 * พิกัดใช้บ่อย (ฝังมากับเว็บ — ทุกเครื่องเห็นเหมือนกัน)
 * ช่อง 1 = ด่านพงยือไร ช่อง 2-10 ยังไม่มี เพิ่มต่อท้ายได้ตามรูปแบบนี้:
 *
 *   {
 *     id: 'preset_checkpoint_2',          // ไม่ซ้ำกัน
 *     name: 'ชื่อจุด',                     // ชื่อที่แสดงในรายการ
 *     lat: 6.499413,
 *     lon: 101.267206,
 *     address: 'อ.เมืองยะลา, จ.ยะลา',      // บรรทัดที่ 3 ของตราประทับ
 *     isDefault: true
 *   },
 *
 * ส่วนพิกัดที่กดบันทึกในหน้าเว็บ จะเก็บใน localStorage ของเครื่องนั้นเท่านั้น
 */
export const DEFAULT_PRESETS = Object.freeze([
  {
    id: 'preset_phongyuerai',
    name: 'ด่านพงยือไร',
    lat: 6.499413,
    lon: 101.267206,
    address: 'อ.เมืองยะลา, จ.ยะลา',
    isDefault: true
  }
]);

const STORAGE_KEY = 'custom_location_presets';
const LEGACY_STORAGE_KEY = 'timestamp_camera_presets_v1';
const MAX_CUSTOM_PRESETS = 50;

// In-memory fallback if localStorage is disabled, throws QuotaExceededError, or is unavailable
let memoryCustomPresets = null;

/**
 * Validates coordinate numbers
 */
function isValidCoord(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number' &&
         !isNaN(lat) && !isNaN(lon) && isFinite(lat) && isFinite(lon) &&
         lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Validates a preset input object
 * @param {Object} input
 * @returns {{ valid: boolean, error?: string, data?: Object }}
 */
export function validatePresetInput(input) {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Preset must be an object' };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) {
    return { valid: false, error: 'Name must be between 1 and 100 characters' };
  }

  const rawLat = typeof input.lat === 'number' ? input.lat : parseFloat(input.lat);
  const rawLon = typeof input.lon === 'number' ? input.lon : parseFloat(input.lon);

  if (!isValidCoord(rawLat, rawLon)) {
    return { valid: false, error: 'Coordinates must be valid numbers (lat: -90..90, lon: -180..180)' };
  }

  const address = typeof input.address === 'string' ? input.address.trim() : '';
  if (address.length > 200) {
    return { valid: false, error: 'Address must not exceed 200 characters' };
  }

  return {
    valid: true,
    data: {
      name,
      lat: parseFloat(rawLat.toFixed(6)),
      lon: parseFloat(rawLon.toFixed(6)),
      address
    }
  };
}

/**
 * Returns deep-cloned array of default curated Thai presets
 * @returns {Array<Object>}
 */
export function getDefaultPresets() {
  return DEFAULT_PRESETS.map(p => ({ ...p }));
}

/**
 * Returns list of user custom presets saved in localStorage, falling back
 * seamlessly to in-memory storage on QuotaExceededError or storage restrictions.
 * @returns {Array<Object>}
 */
export function getCustomPresets() {
  // If memory fallback holds unpersisted/quota-exceeded state, it takes precedence
  if (memoryCustomPresets !== null) {
    return memoryCustomPresets.map(p => ({ ...p }));
  }

  try {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      return [];
    }
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    }
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Filter and sanitize items
    const validPresets = parsed.filter(item => {
      const check = validatePresetInput(item);
      return check.valid && typeof item.id === 'string';
    });

    return validPresets;
  } catch (err) {
    return memoryCustomPresets ? memoryCustomPresets.map(p => ({ ...p })) : [];
  }
}

/**
 * Returns combined list of all presets (Custom first, then Defaults)
 * @returns {Array<Object>}
 */
export function getAllPresets() {
  return [...getCustomPresets(), ...getDefaultPresets()];
}

/**
 * Saves a new custom preset into localStorage with seamless in-memory fallback
 * @param {Object} presetInput - { id?, name, lat, lon, address }
 * @returns {Object|null} The saved preset object or null on validation failure
 */
export function saveCustomPreset(presetInput) {
  const check = validatePresetInput(presetInput);
  if (!check.valid) {
    return null;
  }

  const presetId = (typeof presetInput?.id === 'string' && presetInput.id.trim())
    ? presetInput.id.trim()
    : `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const newPreset = {
    id: presetId,
    ...check.data,
    isDefault: false
  };

  const current = getCustomPresets();
  const existingIdx = current.findIndex(p => p.id === newPreset.id);
  if (existingIdx !== -1) {
    current[existingIdx] = newPreset;
  } else {
    current.unshift(newPreset);
  }

  if (current.length > MAX_CUSTOM_PRESETS) {
    current.length = MAX_CUSTOM_PRESETS;
  }

  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      // Reset memory fallback on successful write to keep localStorage authoritative
      memoryCustomPresets = null;
    } else {
      memoryCustomPresets = current;
    }
  } catch (err) {
    // Catch QuotaExceededError / SecurityError and preserve current state in memory
    memoryCustomPresets = current;
  }

  return newPreset;
}

/**
 * Deletes a custom preset by its ID. Factory presets cannot be deleted.
 * @param {string} id - The preset ID to delete
 * @returns {boolean} true if deleted, false otherwise
 */
export function deleteCustomPreset(id) {
  if (!id || typeof id !== 'string') return false;

  // Protect factory presets
  if (DEFAULT_PRESETS.some(p => p.id === id)) {
    return false;
  }

  const current = getCustomPresets();
  const filtered = current.filter(p => p.id !== id);

  if (filtered.length === current.length) {
    return false;
  }

  if (memoryCustomPresets !== null) {
    memoryCustomPresets = memoryCustomPresets.filter(p => p.id !== id);
  }

  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      // Reset memory fallback on successful write
      memoryCustomPresets = null;
    } else {
      memoryCustomPresets = filtered;
    }
  } catch (err) {
    memoryCustomPresets = filtered;
  }

  return true;
}

/**
 * Clears all custom presets and restores clean state
 */
export function clearCustomPresets() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch (err) {
    // Ignore
  }
  memoryCustomPresets = null;
}
