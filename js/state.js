/**
 * state.js
 * 
 * Central Reactive Application State Store for Timestamp Camera Web.
 * 
 * Features:
 * - Single source of truth for all application state:
 *   - image: HTMLImageElement | ImageBitmap | null
 *   - rawFile: File | Blob | null
 *   - originalFilename: string
 *   - exifData: { orientation, dateTime, latitude, longitude, altitude } | null
 *   - dateTime: Date instance
 *   - isLiveTime: boolean (true = 1Hz ticking clock, false = frozen/custom)
 *   - lat: number (WGS84 decimal latitude)
 *   - lon: number (WGS84 decimal longitude)
 *   - address: string (Thai administrative format e.g. "อ.เมืองยะลา, จ.ยะลา")
 *   - isAddressManual: boolean (dirty flag preventing auto-geocode overwrite)
 *   - selectedPresetId: string | null
 *   - isExporting: boolean (high-resolution export loading state)
 * - Fine-grained subscriber notifications with unsubscribe callbacks
 * - Pure mutations with input validation and boundary checks
 * - Node.js test-runner and headless compatibility
 * 
 * Milestone: M3-UI
 */

import { isValidCoordinate } from './coordinates.js';
import { lookupOfflineAddress } from './geocoder.js';
import { getAllPresets } from './presets.js';
import { isValidDate, toValidDate } from './thai-datetime.js';

/**
 * Default immutable state specification
 */
export const DEFAULT_STATE = Object.freeze({
  image: null,
  rawFile: null,
  originalFilename: '',
  exifData: null,
  isLiveTime: true,
  lat: 6.499413,
  lon: 101.267206,
  address: 'อ.เมืองยะลา, จ.ยะลา',
  isAddressManual: false,
  selectedPresetId: null,
  isExporting: false,
  hasExifGps: false
});

/**
 * Mutable singleton application state
 */
export const appState = {
  ...DEFAULT_STATE,
  dateTime: new Date()
};

/**
 * Subscriber registry
 */
const subscribers = new Set();

/**
 * Returns current snapshot of application state.
 * @returns {typeof appState}
 */
export function getState() {
  return appState;
}

/**
 * Subscribes a listener function to state mutations.
 * @param {Function} listener - Callback receiving (state, changedKeys)
 * @returns {Function} Unsubscribe function
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Broadcasts changes to all registered subscribers.
 * @param {string[]} changedKeys
 */
export function notifySubscribers(changedKeys = []) {
  for (const listener of subscribers) {
    try {
      listener(appState, changedKeys);
    } catch (err) {
      console.error('[State] Subscriber error:', err);
    }
  }
}

/**
 * Sets source image and associated file metadata.
 * 
 * @param {HTMLImageElement|ImageBitmap|null} image
 * @param {File|Blob|null} [file=null]
 * @param {string} [filename='']
 */
export function setImage(image, file = null, filename = '') {
  appState.image = image || null;
  appState.rawFile = file || null;
  
  if (typeof filename === 'string' && filename.trim()) {
    appState.originalFilename = filename.trim();
  } else if (file && typeof file.name === 'string') {
    appState.originalFilename = file.name;
  } else if (!image) {
    appState.originalFilename = '';
  }

  notifySubscribers(['image', 'rawFile', 'originalFilename']);
}

/**
 * Sets current timestamp. Does not change isLiveTime flag.
 * @param {Date|number|string} date
 */
export function setDateTime(date) {
  const valid = toValidDate(date);
  if (valid) {
    appState.dateTime = valid;
    notifySubscribers(['dateTime']);
  }
}

/**
 * Sets custom user-specified date/time and disables live ticking clock.
 * @param {Date|number|string} date
 */
export function setCustomDateTime(date) {
  const valid = toValidDate(date);
  if (valid) {
    appState.dateTime = valid;
    appState.isLiveTime = false;
    notifySubscribers(['dateTime', 'isLiveTime']);
  }
}

/**
 * Toggles live ticking clock. If enabling, immediately synchronizes with current time.
 * @param {boolean} enabled
 */
export function setLiveTime(enabled) {
  appState.isLiveTime = !!enabled;
  if (appState.isLiveTime) {
    appState.dateTime = new Date();
  }
  notifySubscribers(['isLiveTime', 'dateTime']);
}

/**
 * Increments live clock timestamp by 1 tick if isLiveTime is true.
 * @param {Date} [now=new Date()]
 */
export function tickLiveTime(now = new Date()) {
  if (appState.isLiveTime) {
    appState.dateTime = now;
    notifySubscribers(['dateTime']);
  }
}

/**
 * Updates latitude and longitude coordinates.
 * If user has NOT manually edited the address, automatically synchronizes offline address.
 * 
 * @param {number} lat - Latitude (-90 to 90)
 * @param {number} lon - Longitude (-180 to 180)
 * @param {object} [options={}]
 * @param {boolean} [options.skipAddressUpdate=false]
 * @returns {boolean} True if coordinates updated, false if invalid
 */
export function updateCoordinates(lat, lon, options = {}) {
  const numLat = typeof lat === 'number' ? lat : parseFloat(lat);
  const numLon = typeof lon === 'number' ? lon : parseFloat(lon);

  if (!isValidCoordinate(numLat, numLon)) {
    return false;
  }

  appState.lat = parseFloat(numLat.toFixed(6));
  appState.lon = parseFloat(numLon.toFixed(6));

  const changed = ['lat', 'lon'];

  // Address synchronization:
  // If manual address lock is active (isAddressManual === true), address is NEVER overwritten!
  if (!appState.isAddressManual && !options.skipAddressUpdate) {
    try {
      const offline = lookupOfflineAddress(appState.lat, appState.lon);
      if (offline) {
        appState.address = offline;
        changed.push('address');
      }
    } catch {
      // Non-fatal if geocoder index unavailable
    }
  }

  notifySubscribers(changed);
  return true;
}

/**
 * Alias for updateCoordinates matching various caller conventions.
 */
export const setCoordinates = updateCoordinates;

/**
 * Sets address text.
 * @param {string} address
 * @param {boolean} [isManual=false] - Whether this update locks the address from automated geocoding
 */
export function setAddress(address, isManual = false) {
  appState.address = typeof address === 'string' ? address.trim() : '';
  if (isManual) {
    appState.isAddressManual = true;
  }
  notifySubscribers(['address', 'isAddressManual']);
}

/**
 * Sets user-overridden manual address and locks it from automated geocoding overwrites.
 * @param {string} address
 */
export function setManualAddress(address) {
  setAddress(address, true);
}

/**
 * Unlocks manual address edit lock, restoring automated reverse geocoding updates.
 */
export function unlockAddress() {
  appState.isAddressManual = false;
  notifySubscribers(['isAddressManual']);
}

/**
 * Selects a location preset by ID. Updates coordinates, address, and resets manual lock.
 * @param {string} presetId
 * @returns {boolean} True if preset found and applied
 */
export function selectPreset(presetId) {
  if (!presetId || typeof presetId !== 'string') return false;

  const presets = getAllPresets();
  const target = presets.find(p => p.id === presetId);
  if (!target) return false;

  appState.lat = target.lat;
  appState.lon = target.lon;
  appState.address = target.address;
  appState.isAddressManual = false;
  appState.selectedPresetId = target.id;

  notifySubscribers(['lat', 'lon', 'address', 'isAddressManual', 'selectedPresetId']);
  return true;
}

/**
 * Alias for selectPreset matching various caller conventions.
 */
export const setPreset = selectPreset;

/**
 * Applies EXIF metadata extracted from uploaded or captured photo.
 * Updates coordinates (if GPS present), timestamp (if DateTimeOriginal present), and orientation.
 * 
 * @param {object} exif - Parsed EXIF payload
 */
export function applyExifMetadata(exif, { applyDateTime = true } = {}) {
  if (!exif || typeof exif !== 'object') return;

  appState.exifData = {
    orientation: exif.orientation || 1,
    dateTime: exif.dateTime || null,
    latitude: exif.latitude || null,
    longitude: exif.longitude || null,
    altitude: exif.altitude || null
  };

  const changed = ['exifData'];

  // Apply GPS coordinates if valid
  if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number' &&
      isValidCoordinate(exif.latitude, exif.longitude)) {
    appState.lat = parseFloat(exif.latitude.toFixed(6));
    appState.lon = parseFloat(exif.longitude.toFixed(6));
    appState.hasExifGps = true;
    changed.push('lat', 'lon', 'hasExifGps');

    if (!appState.isAddressManual) {
      try {
        const offline = lookupOfflineAddress(appState.lat, appState.lon);
        if (offline) {
          appState.address = offline;
          changed.push('address');
        }
      } catch {
        // Suppress
      }
    }
  } else {
    appState.hasExifGps = false;
    changed.push('hasExifGps');
  }

  // Apply EXIF Date ONLY if applyDateTime is explicitly true
  // In photo upload workflow, user's chosen datetime & liveTime MUST NOT be overwritten
  if (applyDateTime && isValidDate(exif.dateTime)) {
    appState.dateTime = exif.dateTime;
    appState.isLiveTime = false;
    changed.push('dateTime', 'isLiveTime');
  }

  notifySubscribers(changed);
}

/**
 * Updates high-resolution export in-progress state.
 * @param {boolean} isExporting
 */
export function setExporting(isExporting) {
  appState.isExporting = !!isExporting;
  notifySubscribers(['isExporting']);
}

/**
 * Resets application state to initial factory defaults.
 */
export function resetDefaults() {
  appState.image = null;
  appState.rawFile = null;
  appState.originalFilename = '';
  appState.exifData = null;
  appState.dateTime = new Date();
  appState.isLiveTime = true;
  appState.lat = DEFAULT_STATE.lat;
  appState.lon = DEFAULT_STATE.lon;
  appState.address = DEFAULT_STATE.address;
  appState.isAddressManual = false;
  appState.selectedPresetId = DEFAULT_STATE.selectedPresetId;
  appState.isExporting = false;
  appState.hasExifGps = false;

  notifySubscribers(Object.keys(DEFAULT_STATE).concat(['dateTime']));
}

/**
 * Generic state updater for batch updates.
 * @param {Partial<typeof appState>} partial
 */
export function updateState(partial) {
  if (!partial || typeof partial !== 'object') return;

  const changed = [];
  for (const key of Object.keys(partial)) {
    if (key in appState) {
      appState[key] = partial[key];
      changed.push(key);
    }
  }

  if (changed.length > 0) {
    notifySubscribers(changed);
  }
}
