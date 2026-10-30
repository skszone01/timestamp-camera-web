/**
 * app.js
 *
 * UI wiring for Timestamp Camera Web (Single Photo & Multi-Photo Batch Mode).
 *
 * Flow:
 * 1. User picks / captures 1 or multiple photos.
 * 2. GPS in the photo's EXIF becomes the stamp location (lat/lon), and the location is
 *    reverse geocoded online (Google if a key is configured, otherwise OpenStreetMap)
 *    into "อ.<อำเภอ>, จ.<จังหวัด>".
 * 3. When multiple photos are selected (Batch Mode):
 *    - Photo #1 starts at the selected base date/time and base coordinate.
 *    - Each subsequent photo (#2, #3, ...) automatically advances its timestamp by a random
 *      2–5 minutes (120–300 seconds) and jitters its coordinate by a random 5–10 meters
 *      from the previous photo.
 * 4. Date/time is always chosen by the user (live clock, or any past/future value).
 * 5. Export renders full-resolution JPEG(s), then a result sheet offers Share/Save
 *    (supporting multi-file Web Share on iOS/Android) and direct download.
 */

import {
  getState,
  subscribe,
  setImage,
  setCustomDateTime,
  setLiveTime,
  tickLiveTime,
  updateCoordinates,
  setAddress,
  setManualAddress,
  unlockAddress,
  updateState,
  resetDefaults
} from './state.js';

import { formatThaiBuddhistDate, toValidDate } from './thai-datetime.js';
import { formatCoordinates, formatSignedComponent, isValidCoordinate, parseLocationInput, isShortMapUrl } from './coordinates.js';
import { resolveThaiAddress, searchPlaces } from './geocoder.js';
import {
  getDefaultPresets,
  getCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  jitterCoordinate,
  distanceMeters,
  randomBatchTimeStepSeconds,
  PRESET_SLOT_COUNT
} from './presets.js';
import { parseExif, readJpegSize } from './exif-parser.js';
import { loadWatermarkFonts } from './font-loader.js';
import { renderPreview, renderWatermark, exportFullResolution } from './watermark-engine.js';
import { generateExportFilename, canUseWebShare, shareFile, downloadBlob, getInAppBrowserName, isAppleMobile } from './export-manager.js';
import { initMap, setMapCoordinates } from './map-picker.js';

const LAST_LOCATION_KEY = 'tc_last_location';

const SOURCE_LABELS = {
  default: { text: 'ค่าเริ่มต้น', tone: '' },
  last: { text: 'ใช้ล่าสุด', tone: '' },
  exif: { text: 'จากรูปภาพ', tone: 'is-ok' },
  batch: { text: 'สุ่มพิกัด 5–10 ม.', tone: 'is-accent' },
  gps: { text: 'GPS เครื่องนี้', tone: 'is-ok' },
  map: { text: 'เลือกบนแผนที่', tone: 'is-accent' },
  preset: { text: 'พิกัดที่บันทึกไว้', tone: 'is-accent' },
  link: { text: 'จากลิงก์/ข้อความ', tone: 'is-accent' },
  search: { text: 'ค้นหาชื่อสถานที่', tone: 'is-accent' },
  manual: { text: 'พิมพ์เอง', tone: 'is-accent' }
};

const PROVIDER_LABELS = {
  google: 'Google',
  nominatim: 'OpenStreetMap'
};

let el = {};
let clockInterval = null;
let repaintRequest = null;
let addressToken = 0;
let exportBlob = null;
let exportUrl = null;
let exportFilename = '';
let batchExportResults = []; // Array of { blob, url, filename, file }
let imageOrientation = 1;    // EXIF orientation the browser's decoder did NOT apply, so we draw it
let userQuarterTurns = 0;    // Extra clockwise 90° turns from the rotate button

// Multi-photo batch state
let batchItems = [];         // Array of batch item objects
let activeBatchIndex = 0;    // Index of currently previewed photo in batchItems
let isSwitchingBatchItem = false;

// 2x1 JPEG tagged EXIF orientation 6: a decoder that honours the tag returns a 1x2 image
const ORIENTATION_TEST_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////////////////////////////////////////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCKiiiszsP/2Q==';
const decoderOrientsCache = {};

// EXIF orientations as [mirrored][clockwise quarter turns] (mirror applied first, then the turn)
const ORIENTATION_BY_TURNS = [[1, 6, 3, 8], [2, 7, 4, 5]];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export function queryDOMElements() {
  if (typeof document === 'undefined') return {};
  const $ = (id) => document.getElementById(id);
  return {
    canvas: $('preview-canvas'),
    placeholder: $('viewfinder-placeholder'),
    banner: $('gps-banner'),
    bannerText: $('gps-banner-text'),
    bannerActions: $('gps-banner-actions'),

    batchBar: $('batch-bar'),
    batchCountBadge: $('batch-count-badge'),
    batchSummary: $('batch-summary'),
    batchList: $('batch-list'),
    rerollBatchBtn: $('btn-reroll-batch'),
    addImagesBtn: $('btn-add-images'),

    fileInput: $('file-input'),
    addFilesInput: $('add-files-input'),
    cameraInput: $('camera-input'),
    albumBtn: $('btn-album'),
    cameraBtn: $('btn-camera'),
    replaceBtn: $('btn-replace-image'),
    rotateBtn: $('btn-rotate'),
    resetAllBtn: $('btn-reset-all'),

    datetimeOutput: $('datetime-output'),
    liveToggle: $('live-time-toggle'),
    datetimeInput: $('datetime-input'),
    secondsInput: $('seconds-input'),
    randomStepBtn: $('btn-random-step'),
    exifTimeBtn: $('btn-exif-time'),

    coordsSource: $('coords-source'),
    presetsBtn: $('btn-presets'),
    gpsBtn: $('btn-quick-gps'),
    latInput: $('lat-input'),
    lonInput: $('lon-input'),
    mapLinkInput: $('map-link-input'),
    parseLinkBtn: $('btn-parse-link'),
    googleLink: $('link-google-maps'),
    placeSearchForm: $('place-search-form'),
    placeSearchInput: $('place-search-input'),
    placeSearchBtn: $('btn-place-search'),
    placeSearchStatus: $('place-search-status'),
    placeResults: $('place-results'),

    addressInput: $('address-input'),
    addressStatus: $('address-status'),
    resetAddressBtn: $('btn-reset-address'),

    exportBtn: $('btn-export'),

    presetsSheet: $('presets-sheet'),
    presetsList: $('presets-list'),
    presetsEmpty: $('presets-empty'),
    savePresetBtn: $('btn-save-preset'),

    resultSheet: $('result-sheet'),
    resultTitle: $('result-title'),
    resultImage: $('result-image'),
    resultBatchGrid: $('result-batch-grid'),
    resultHint: $('result-hint'),
    shareBtn: $('btn-share'),
    downloadBtn: $('btn-download'),

    toasts: $('toast-container')
  };
}

export function showToast(message, duration = 3200) {
  if (!el.toasts) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  el.toasts.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setTag(node, text, tone = '') {
  if (!node) return;
  node.textContent = text;
  node.className = `tag ${tone}`.trim();
}

function openSheet(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeSheet(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

function getWatermarkData(state = getState()) {
  return {
    dateTimeStr: formatThaiBuddhistDate(state.dateTime),
    coordsStr: formatCoordinates(state.lat, state.lon),
    addressStr: state.address
  };
}

export function renderPreviewCanvas() {
  const canvas = el.canvas;
  if (!canvas) return;
  const state = getState();
  const data = getWatermarkData(state);

  if (state.image) {
    renderPreview(canvas, state.image, data, { orientation: getDrawOrientation() });
    return;
  }

  // No photo yet: draw a neutral frame so the stamp layout is visible
  if (canvas.width !== 1280 || canvas.height !== 960) {
    canvas.width = 1280;
    canvas.height = 960;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#1b1f27');
  grad.addColorStop(1, '#0c0e12');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderWatermark(ctx, canvas.width, canvas.height, data);
}

export function scheduleRepaint() {
  if (repaintRequest !== null) return;
  if (typeof requestAnimationFrame !== 'function') {
    renderPreviewCanvas();
    return;
  }
  repaintRequest = requestAnimationFrame(() => {
    repaintRequest = null;
    renderPreviewCanvas();
  });
}

// ---------------------------------------------------------------------------
// Date & time
// ---------------------------------------------------------------------------

function toMinuteLocalString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatShortTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '--:--:--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function syncDateTimeControls(state) {
  const d = state.dateTime;
  if (el.datetimeOutput) el.datetimeOutput.textContent = formatThaiBuddhistDate(d);
  // Don't fight the user while they're typing into a field
  if (el.datetimeInput && document.activeElement !== el.datetimeInput) {
    el.datetimeInput.value = toMinuteLocalString(d);
  }
  if (el.secondsInput && document.activeElement !== el.secondsInput) {
    el.secondsInput.value = String(d.getSeconds()).padStart(2, '0');
  }
}

function propagateDateTimeAcrossBatch(newDateForActive) {
  if (!batchItems.length || isSwitchingBatchItem) return;
  const active = batchItems[activeBatchIndex];
  if (!active) return;

  active.dateTime = new Date(newDateForActive.getTime());

  // Cascade forward to subsequent items in the batch using their 2-5 min stepSeconds
  for (let i = activeBatchIndex + 1; i < batchItems.length; i++) {
    const prev = batchItems[i - 1];
    if (!batchItems[i].stepSeconds || batchItems[i].stepSeconds < 120) {
      batchItems[i].stepSeconds = randomBatchTimeStepSeconds({ prevDate: prev.dateTime });
    }
    batchItems[i].dateTime = new Date(prev.dateTime.getTime() + batchItems[i].stepSeconds * 1000);
  }
  renderBatchStrip();
}

function applyCustomDateTimeFromInputs() {
  const value = el.datetimeInput?.value || '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return;
  let seconds = parseInt(el.secondsInput?.value, 10);
  if (!Number.isFinite(seconds)) seconds = getState().dateTime.getSeconds();
  seconds = Math.min(59, Math.max(0, seconds));
  const [, y, mo, d, h, mi] = match.map(Number);
  const next = new Date(y, mo - 1, d, h, mi, seconds);
  if (!Number.isNaN(next.getTime())) {
    setCustomDateTime(next);
    propagateDateTimeAcrossBatch(next);
  }
}

function shiftDateTime({ days = 0, minutes = 0, seconds = 0 }) {
  const base = new Date(getState().dateTime.getTime());
  if (days) base.setDate(base.getDate() + days);
  if (minutes) base.setMinutes(base.getMinutes() + minutes);
  if (seconds) base.setSeconds(base.getSeconds() + seconds);
  setCustomDateTime(base);
  propagateDateTimeAcrossBatch(base);
}

/**
 * Steps current time forward by 2–5 minutes (120–300s) and jitters coordinates by 5–10 meters.
 */
function stepRandomTimeAndCoord() {
  const state = getState();
  const stepSec = randomBatchTimeStepSeconds({ prevDate: state.dateTime });
  const nextDate = new Date(state.dateTime.getTime() + stepSec * 1000);
  const jittered = jitterCoordinate(state.lat, state.lon, { avoid: { lat: state.lat, lon: state.lon } });

  setCustomDateTime(nextDate);
  propagateDateTimeAcrossBatch(nextDate);

  setLocation(jittered.lat, jittered.lon, 'batch', { address: state.address });
  const minPart = Math.floor(stepSec / 60);
  const secPart = stepSec % 60;
  showToast(`ขยับเวลา +${minPart} นาที ${secPart} วิ · ขยับพิกัด ${jittered.meters.toFixed(1)} ม.`);
}

export function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(() => {
    if (getState().isLiveTime) tickLiveTime(new Date());
  }, 1000);
}

export function stopClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = null;
}

// ---------------------------------------------------------------------------
// Location & address
// ---------------------------------------------------------------------------

function rememberLocation() {
  const { lat, lon, address } = getState();
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat, lon, address }));
  } catch {
    // Storage unavailable (private mode) — not critical
  }
}

function loadRememberedLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || 'null');
    if (saved && isValidCoordinate(saved.lat, saved.lon)) return saved;
  } catch {
    // ignore
  }
  return null;
}

function renderCoordsSource(source) {
  const label = SOURCE_LABELS[source] || SOURCE_LABELS.default;
  setTag(el.coordsSource, label.text, label.tone);
}

/**
 * Re-resolves the address for the current coordinates unless the user typed their own.
 */
export function refreshAddress() {
  const state = getState();
  if (state.isAddressManual) return;

  const token = ++addressToken;
  const { lat, lon } = state;
  let lastSource = 'offline';
  setTag(el.addressStatus, 'กำลังค้นหา…', '');

  resolveThaiAddress(lat, lon, {
    isAddressManual: false,
    onUpdate: (address, meta = {}) => {
      const now = getState();
      if (token !== addressToken || now.isAddressManual || now.lat !== lat || now.lon !== lon) return;
      if (address) {
        setAddress(address, false);
        syncAddressAcrossBatch(address);
      }
      lastSource = meta.source || 'offline';
      if (lastSource !== 'offline') {
        setTag(el.addressStatus, `จาก ${PROVIDER_LABELS[lastSource] || lastSource}`, 'is-ok');
        rememberLocation();
      }
    }
  }).then((finalAddress) => {
    if (token !== addressToken || getState().isAddressManual) return;
    if (finalAddress) syncAddressAcrossBatch(finalAddress);
    if (lastSource === 'offline') {
      if (finalAddress) {
        setTag(el.addressStatus, 'ประมาณ (ออฟไลน์)', 'is-warn');
      } else {
        setTag(el.addressStatus, 'ไม่พบ — พิมพ์เอง', 'is-warn');
      }
      rememberLocation();
    }
  });
}

function syncAddressAcrossBatch(address) {
  if (!batchItems.length || !address) return;
  for (const item of batchItems) {
    item.address = address;
  }
}

function propagateLocationAcrossBatch(anchorLat, anchorLon, source, explicitAddress) {
  if (!batchItems.length || isSwitchingBatchItem) return;
  const active = batchItems[activeBatchIndex];
  if (!active) return;

  active.lat = parseFloat(Number(anchorLat).toFixed(6));
  active.lon = parseFloat(Number(anchorLon).toFixed(6));
  active.source = source;
  if (explicitAddress) active.address = explicitAddress;

  // If the user explicitly changed location (via preset, map, search, link, gps) while multiple photos are loaded,
  // update all other photos in the batch to jitter 5–10m sequentially from the new location!
  if (batchItems.length > 1 && ['preset', 'map', 'search', 'link', 'gps', 'manual'].includes(source)) {
    let prevPoint = { lat: active.lat, lon: active.lon };
    for (let i = 0; i < batchItems.length; i++) {
      if (i === activeBatchIndex) continue;
      const j = jitterCoordinate(prevPoint.lat, prevPoint.lon, { avoid: prevPoint });
      batchItems[i].lat = j.lat;
      batchItems[i].lon = j.lon;
      batchItems[i].metersFromPrev = j.meters;
      batchItems[i].source = 'batch';
      if (explicitAddress) batchItems[i].address = explicitAddress;
      prevPoint = { lat: j.lat, lon: j.lon };
    }
    renderBatchStrip();
  }
}

/**
 * Single entry point for every location change.
 * @param {number} lat
 * @param {number} lon
 * @param {keyof SOURCE_LABELS} source
 * @param {{ zoom?: boolean, address?: string }} [opts]
 */
export function setLocation(lat, lon, source, opts = {}) {
  if (!isValidCoordinate(lat, lon)) return false;

  const hasPresetAddress = typeof opts.address === 'string' && opts.address.trim() !== '';
  if (hasPresetAddress || source === 'exif') {
    unlockAddress();
  }

  updateCoordinates(lat, lon, { skipAddressUpdate: hasPresetAddress });
  const state = getState();
  setMapCoordinates(state.lat, state.lon, opts.zoom !== false, { silent: true });
  renderCoordsSource(source);

  if (hasPresetAddress) {
    addressToken++;
    setAddress(opts.address, false);
    syncAddressAcrossBatch(opts.address);
    setTag(el.addressStatus, source === 'batch' ? 'สุ่มพิกัด 5–10 ม.' : 'จากพิกัดที่บันทึกไว้', 'is-accent');
    rememberLocation();
  } else {
    refreshAddress();
  }

  propagateLocationAcrossBatch(state.lat, state.lon, source, hasPresetAddress ? opts.address : state.address);
  return true;
}

function requestDeviceLocation({ quiet = false } = {}) {
  if (!navigator.geolocation) {
    showToast('เบราว์เซอร์นี้ไม่รองรับ GPS');
    return;
  }
  el.gpsBtn?.classList.add('is-busy');
  if (!quiet) showToast('กำลังหาตำแหน่ง GPS…', 2000);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.gpsBtn?.classList.remove('is-busy');
      setLocation(pos.coords.latitude, pos.coords.longitude, 'gps');
      showToast(`ได้พิกัด GPS (แม่นยำ ±${Math.round(pos.coords.accuracy)} ม.)`);
    },
    (err) => {
      el.gpsBtn?.classList.remove('is-busy');
      const reason = err.code === 1
        ? 'ไม่ได้อนุญาตให้เข้าถึงตำแหน่ง (เปิดในการตั้งค่าเบราว์เซอร์)'
        : 'หาตำแหน่งไม่สำเร็จ ลองอีกครั้งในที่โล่ง';
      showToast(reason, 4500);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function applyLocationText(text, source) {
  const value = (text || '').trim();
  if (!value) return false;
  const coords = parseLocationInput(value);
  if (coords) {
    setLocation(coords.lat, coords.lon, source);
    return true;
  }
  if (isShortMapUrl(value)) {
    showToast('ลิงก์ย่อ (maps.app.goo.gl) อ่านพิกัดไม่ได้ — เปิดลิงก์ใน Google Maps แล้วคัดลอกตัวเลขพิกัดมาวางแทน', 6000);
  } else {
    showToast('อ่านพิกัดไม่ได้ ใช้รูปแบบ 6.499413, 101.267206');
  }
  return false;
}

function syncLocationControls(state, changedKeys) {
  if (changedKeys.includes('lat') && el.latInput && document.activeElement !== el.latInput) {
    el.latInput.value = formatSignedComponent(state.lat);
    el.latInput.classList.remove('is-invalid');
  }
  if (changedKeys.includes('lon') && el.lonInput && document.activeElement !== el.lonInput) {
    el.lonInput.value = formatSignedComponent(state.lon);
    el.lonInput.classList.remove('is-invalid');
  }
  if (el.googleLink) {
    el.googleLink.href = `https://www.google.com/maps/search/?api=1&query=${state.lat},${state.lon}`;
  }
}

function syncAddressControls(state, changedKeys) {
  if (changedKeys.includes('address') && el.addressInput && document.activeElement !== el.addressInput) {
    el.addressInput.value = state.address;
  }
  if (changedKeys.includes('isAddressManual')) {
    if (el.resetAddressBtn) el.resetAddressBtn.hidden = !state.isAddressManual;
    if (state.isAddressManual) setTag(el.addressStatus, 'แก้ไขเอง', 'is-accent');
  }
}

// ---------------------------------------------------------------------------
// Banner (GPS-from-photo status)
// ---------------------------------------------------------------------------

function showBanner(tone, text, actions = []) {
  if (!el.banner) return;
  el.banner.hidden = false;
  el.banner.className = `banner ${tone}`.trim();
  el.bannerText.textContent = text;
  el.bannerActions.innerHTML = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    el.bannerActions.appendChild(btn);
  }
}

function hideBanner() {
  if (el.banner) el.banner.hidden = true;
}

// ---------------------------------------------------------------------------
// Photo loading & Multi-Photo Batch Management
// ---------------------------------------------------------------------------

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

function decodeWith(method, file) {
  return method === 'bitmap'
    ? createImageBitmap(file, { imageOrientation: 'from-image' })
    : loadImageElement(file);
}

/** @returns {Promise<{ image: ImageBitmap|HTMLImageElement, method: 'bitmap'|'img' }>} */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return { image: await decodeWith('bitmap', file), method: 'bitmap' };
    } catch {
      // Fall through to <img> decoding (older Safari)
    }
  }
  return { image: await loadImageElement(file), method: 'img' };
}

/** Whether this browser's decoder already rotates JPEGs by their EXIF tag (varies by browser/version). */
function decoderAppliesOrientation(method) {
  if (!(method in decoderOrientsCache)) {
    decoderOrientsCache[method] = (async () => {
      try {
        const bytes = Uint8Array.from(atob(ORIENTATION_TEST_JPEG), (c) => c.charCodeAt(0));
        const img = await decodeWith(method, new Blob([bytes], { type: 'image/jpeg' }));
        return (img.naturalWidth || img.width) === 1;
      } catch {
        return true;
      }
    })();
  }
  return decoderOrientsCache[method];
}

/**
 * Finds the EXIF orientation still to be drawn on the decoded image: 1 when the browser
 * already turned it upright, the EXIF value when it did not.
 */
async function findUnappliedOrientation(file, exifOrientation, decoded) {
  if (!(exifOrientation > 1 && exifOrientation <= 8)) return 1;
  // Only JPEG: HEIC/PNG/WebP orientation is handled by the browser itself
  const raw = await readJpegSize(file).catch(() => null);
  if (!raw) return 1;

  if (exifOrientation >= 5 && raw.width !== raw.height) {
    // A 90° tag swaps width/height, so the decoded shape shows whether it was applied
    const width = decoded.image.naturalWidth || decoded.image.width;
    const height = decoded.image.naturalHeight || decoded.image.height;
    return (width > height) === (raw.width > raw.height) ? exifOrientation : 1;
  }
  return (await decoderAppliesOrientation(decoded.method)) ? 1 : exifOrientation;
}

function getItemDrawOrientation(baseOrient, quarterTurns) {
  for (const row of ORIENTATION_BY_TURNS) {
    const turns = row.indexOf(baseOrient);
    if (turns >= 0) return row[(turns + quarterTurns) % 4];
  }
  return 1;
}

function getDrawOrientation() {
  return getItemDrawOrientation(imageOrientation, userQuarterTurns);
}

function rotateImage() {
  if (!getState().image) return;
  userQuarterTurns = (userQuarterTurns + 1) % 4;
  if (batchItems[activeBatchIndex]) {
    batchItems[activeBatchIndex].userQuarterTurns = userQuarterTurns;
  }
  scheduleRepaint();
}

function disposeBatchThumbnails(items) {
  for (const item of items) {
    if (item.thumbUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      try { URL.revokeObjectURL(item.thumbUrl); } catch { /* ignore */ }
    }
  }
}

function updateExportButtonLabel() {
  if (!el.exportBtn) return;
  if (batchItems.length > 1) {
    el.exportBtn.textContent = `บันทึกทั้งหมด (${batchItems.length} ภาพ)`;
  } else {
    el.exportBtn.textContent = 'บันทึกภาพ';
  }
}

export function renderBatchStrip() {
  if (!el.batchBar || !el.batchList) return;
  if (batchItems.length === 0) {
    el.batchBar.hidden = true;
    el.batchList.innerHTML = '';
    updateExportButtonLabel();
    return;
  }

  el.batchBar.hidden = false;
  if (el.batchCountBadge) {
    el.batchCountBadge.textContent = batchItems.length > 1
      ? `รูปที่ ${activeBatchIndex + 1} / ${batchItems.length}`
      : '1 ภาพ';
  }
  if (el.batchSummary) {
    if (batchItems.length > 1) {
      const active = batchItems[activeBatchIndex];
      if (activeBatchIndex === 0) {
        el.batchSummary.textContent = `ภาพเริ่มต้น (${formatShortTime(active.dateTime)}) · ภาพถัดไปสุ่ม +2–5 นาที & 5–10 ม.`;
      } else {
        const minStep = Math.floor((active.stepSeconds || 0) / 60);
        const secStep = (active.stepSeconds || 0) % 60;
        const dist = (active.metersFromPrev || 0).toFixed(1);
        el.batchSummary.textContent = `+${minStep} นาที ${secStep} วิ จากภาพก่อน · ห่าง ${dist} ม.`;
      }
    } else {
      el.batchSummary.textContent = 'กด "+ เพิ่มรูป" เพื่อเลือกหลายภาพ หรือกด "🎲 สุ่มเวลา/พิกัดใหม่"';
    }
  }

  el.batchList.innerHTML = '';
  batchItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = `batch-item${idx === activeBatchIndex ? ' is-active' : ''}`;

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'batch-select';
    selectBtn.setAttribute('role', 'tab');
    selectBtn.setAttribute('aria-selected', idx === activeBatchIndex ? 'true' : 'false');
    selectBtn.addEventListener('click', () => selectBatchItem(idx));

    if (item.thumbUrl) {
      const img = document.createElement('img');
      img.className = 'batch-thumb';
      img.src = item.thumbUrl;
      img.alt = `รูปที่ ${idx + 1}`;
      selectBtn.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className = 'batch-meta';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'batch-meta-time';
    timeSpan.textContent = formatShortTime(item.dateTime);

    const offsetSpan = document.createElement('span');
    offsetSpan.className = 'batch-meta-offset';
    if (idx === 0) {
      offsetSpan.textContent = item.metersFromPrev > 0
        ? `เริ่มต้น · ${item.metersFromPrev.toFixed(1)} ม.`
        : 'ภาพเริ่มต้น';
    } else {
      const m = Math.floor((item.stepSeconds || 0) / 60);
      const s = String((item.stepSeconds || 0) % 60).padStart(2, '0');
      offsetSpan.textContent = `+${m}:${s} นาที · ${(item.metersFromPrev || 0).toFixed(1)} ม.`;
    }

    meta.append(timeSpan, offsetSpan);
    selectBtn.appendChild(meta);

    const badge = document.createElement('span');
    badge.className = 'batch-badge';
    badge.textContent = `#${idx + 1}`;

    card.append(selectBtn, badge);

    if (batchItems.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'batch-remove';
      removeBtn.title = `ลบรูปที่ ${idx + 1}`;
      removeBtn.setAttribute('aria-label', `ลบรูปที่ ${idx + 1}`);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeBatchItem(idx);
      });
      card.appendChild(removeBtn);
    }

    el.batchList.appendChild(card);
  });

  updateExportButtonLabel();
}

export function selectBatchItem(index) {
  if (index < 0 || index >= batchItems.length) return;
  activeBatchIndex = index;
  const item = batchItems[index];

  isSwitchingBatchItem = true;
  try {
    imageOrientation = item.imageOrientation;
    userQuarterTurns = item.userQuarterTurns;
    setImage(item.image, item.file, item.name);
    setCustomDateTime(item.dateTime);
    updateCoordinates(item.lat, item.lon, { skipAddressUpdate: true });
    if (item.address) setAddress(item.address, getState().isAddressManual);
    setMapCoordinates(item.lat, item.lon, false, { silent: true });
    renderCoordsSource(item.source || 'batch');
    if (el.exifTimeBtn) el.exifTimeBtn.hidden = !item.exifDate;
  } finally {
    isSwitchingBatchItem = false;
  }

  renderBatchStrip();
  scheduleRepaint();
}

function removeBatchItem(index) {
  if (index < 0 || index >= batchItems.length) return;
  const [removed] = batchItems.splice(index, 1);
  if (removed) disposeBatchThumbnails([removed]);

  if (batchItems.length === 0) {
    activeBatchIndex = 0;
    setImage(null, null, '');
    renderBatchStrip();
    return;
  }

  if (activeBatchIndex >= batchItems.length) {
    activeBatchIndex = batchItems.length - 1;
  }
  selectBatchItem(activeBatchIndex);
}

/**
 * Re-randomizes time steps (+2 to 5 min per photo) and coordinate jitters (5 to 10 m per photo)
 * across the entire batch.
 */
export function rerollBatchSchedule() {
  if (batchItems.length <= 1) {
    stepRandomTimeAndCoord();
    return;
  }

  const first = batchItems[0];
  let currentDate = new Date(first.dateTime.getTime());
  // Also jitter the first item 5-10m from its anchor so re-rolling gives a fresh set of coordinates
  const firstJitter = jitterCoordinate(first.baseLat, first.baseLon, { avoid: { lat: first.lat, lon: first.lon } });
  first.lat = firstJitter.lat;
  first.lon = firstJitter.lon;
  first.metersFromPrev = firstJitter.meters;
  first.source = 'batch';

  let prevPoint = { lat: first.lat, lon: first.lon };
  for (let i = 1; i < batchItems.length; i++) {
    const item = batchItems[i];
    const stepSeconds = randomBatchTimeStepSeconds({ prevDate: currentDate });
    currentDate = new Date(currentDate.getTime() + stepSeconds * 1000);
    item.stepSeconds = stepSeconds;
    item.dateTime = new Date(currentDate.getTime());

    const anchorLat = item.hasExifGps && distanceMeters(item.baseLat, item.baseLon, prevPoint.lat, prevPoint.lon) > 20
      ? item.baseLat
      : prevPoint.lat;
    const anchorLon = item.hasExifGps && distanceMeters(item.baseLat, item.baseLon, prevPoint.lat, prevPoint.lon) > 20
      ? item.baseLon
      : prevPoint.lon;

    const j = jitterCoordinate(anchorLat, anchorLon, { avoid: prevPoint });
    item.lat = j.lat;
    item.lon = j.lon;
    item.metersFromPrev = distanceMeters(prevPoint.lat, prevPoint.lon, j.lat, j.lon);
    item.source = 'batch';
    prevPoint = { lat: j.lat, lon: j.lon };
  }

  selectBatchItem(activeBatchIndex);
  showToast(`สุ่มเวลาใหม่ (+2–5 นาที/ภาพ) และสุ่มพิกัดใหม่ (5–10 ม./ภาพ) ทั้ง ${batchItems.length} ภาพแล้ว`);
}

/**
 * Decodes and adds one or more File objects into the batch.
 * @param {FileList|File[]} files
 * @param {{ fromCamera?: boolean, append?: boolean }} [opts]
 */
export async function handleImageFiles(files, opts = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;

  if (!opts.append) {
    disposeBatchThumbnails(batchItems);
    batchItems = [];
    activeBatchIndex = 0;
  }

  const decodedItems = [];
  for (const file of list) {
    const [exifResult, imageResult] = await Promise.allSettled([parseExif(file), decodeImage(file)]);
    if (imageResult.status !== 'fulfilled') {
      const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
      showToast(isHeic
        ? 'เบราว์เซอร์นี้เปิดไฟล์ HEIC ไม่ได้ — เปิดเว็บนี้บน iPhone (Safari) หรือแปลงรูปเป็น JPG ก่อน'
        : `เปิดไฟล์ ${file.name || 'รูปนี้'} ไม่ได้`, 6000);
      continue;
    }

    const exif = exifResult.status === 'fulfilled' ? exifResult.value : null;
    const unappliedOrient = await findUnappliedOrientation(file, exif?.orientation, imageResult.value);
    const exifDate = toValidDate(exif?.dateTime);
    const hasGps = typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number' &&
      isValidCoordinate(exif.latitude, exif.longitude) && !(exif.latitude === 0 && exif.longitude === 0);

    const thumbUrl = (typeof URL !== 'undefined' && URL.createObjectURL && file instanceof Blob)
      ? URL.createObjectURL(file)
      : '';

    decodedItems.push({
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name || 'photo.jpg',
      image: imageResult.value.image,
      thumbUrl,
      imageOrientation: unappliedOrient,
      userQuarterTurns: 0,
      exif,
      exifDate,
      hasExifGps: hasGps,
      baseLat: hasGps ? parseFloat(exif.latitude.toFixed(6)) : null,
      baseLon: hasGps ? parseFloat(exif.longitude.toFixed(6)) : null,
      lat: 0,
      lon: 0,
      metersFromPrev: 0,
      stepSeconds: 0,
      dateTime: new Date(),
      address: getState().address,
      source: hasGps ? 'exif' : 'default'
    });
  }

  if (!decodedItems.length) return;

  const state = getState();
  const isAddingToExisting = opts.append && batchItems.length > 0;
  const isMultiPhoto = (batchItems.length + decodedItems.length) > 1;

  // Freeze live clock when loading multiple photos so timestamps stay locked to the batch schedule
  if (isMultiPhoto && state.isLiveTime) {
    setLiveTime(false);
  }

  // Determine starting anchor date & coordinates
  let prevDate = isAddingToExisting
    ? new Date(batchItems[batchItems.length - 1].dateTime.getTime())
    : new Date(getState().dateTime.getTime());

  const firstWithGps = decodedItems.find(it => it.hasExifGps);
  let anchorLat = isAddingToExisting
    ? batchItems[batchItems.length - 1].lat
    : (firstWithGps ? firstWithGps.baseLat : state.lat);
  let anchorLon = isAddingToExisting
    ? batchItems[batchItems.length - 1].lon
    : (firstWithGps ? firstWithGps.baseLon : state.lon);

  let prevPoint = { lat: anchorLat, lon: anchorLon };

  decodedItems.forEach((item, idx) => {
    const globalIndex = batchItems.length;
    if (item.baseLat === null || item.baseLon === null) {
      item.baseLat = anchorLat;
      item.baseLon = anchorLon;
    }

    if (globalIndex === 0) {
      // First photo in the batch: uses base dateTime and initial coordinate
      item.stepSeconds = 0;
      item.dateTime = new Date(prevDate.getTime());
      item.lat = item.baseLat;
      item.lon = item.baseLon;
      item.metersFromPrev = 0;
      item.source = item.hasExifGps ? 'exif' : 'default';
      prevPoint = { lat: item.lat, lon: item.lon };
    } else {
      // Subsequent photos (#2, #3, ...):
      // 1) Random time step +2 to 5 minutes (120-300 seconds) from previous photo
      const stepSec = randomBatchTimeStepSeconds({ prevDate });
      prevDate = new Date(prevDate.getTime() + stepSec * 1000);
      item.stepSeconds = stepSec;
      item.dateTime = new Date(prevDate.getTime());

      // 2) Random coordinate jitter 5 to 10 meters from previous photo (or from its own EXIF GPS if at a different site)
      const baseForJitter = (item.hasExifGps && distanceMeters(item.baseLat, item.baseLon, prevPoint.lat, prevPoint.lon) > 20)
        ? { lat: item.baseLat, lon: item.baseLon }
        : prevPoint;

      const j = jitterCoordinate(baseForJitter.lat, baseForJitter.lon, { avoid: prevPoint });
      item.lat = j.lat;
      item.lon = j.lon;
      item.metersFromPrev = distanceMeters(prevPoint.lat, prevPoint.lon, j.lat, j.lon);
      item.source = 'batch';
      prevPoint = { lat: j.lat, lon: j.lon };
    }

    batchItems.push(item);
  });

  // Select the first photo (or first newly added photo) and resolve address
  const targetIndex = isAddingToExisting ? batchItems.length - decodedItems.length : 0;
  const primary = batchItems[0];

  updateState({
    exifData: primary.exif?.hasExif ? {
      orientation: 1,
      dateTime: primary.exifDate,
      latitude: primary.exif.latitude ?? null,
      longitude: primary.exif.longitude ?? null,
      altitude: primary.exif.altitude ?? null
    } : null,
    hasExifGps: primary.hasExifGps
  });

  selectBatchItem(targetIndex);

  // Trigger address lookup for the anchor coordinate
  if (primary.hasExifGps) {
    setLocation(batchItems[activeBatchIndex].lat, batchItems[activeBatchIndex].lon, batchItems.length > 1 ? 'batch' : 'exif');
    const now = getState();
    const batchNote = batchItems.length > 1
      ? ` · สุ่มเวลา +2–5 นาที & พิกัด 5–10 ม. ครบ ${batchItems.length} ภาพ`
      : '';
    showBanner('is-ok', `ใช้พิกัดจากรูป: ${formatCoordinates(now.lat, now.lon)} · ${now.address}${batchNote}`);
    const token = addressToken;
    const unsub = subscribe((st, keys) => {
      if (token !== addressToken) { unsub(); return; }
      if (keys.includes('address')) {
        el.bannerText.textContent = `ใช้พิกัดจากรูป: ${formatCoordinates(st.lat, st.lon)} · ${st.address}${batchNote}`;
      }
    });
    return;
  }

  if (opts.fromCamera) {
    showBanner('is-warn', 'รูปจากกล้องเว็บไม่มีพิกัดแนบมา กำลังใช้ GPS ของเครื่องแทน…');
    requestDeviceLocation({ quiet: true });
    return;
  }

  if (batchItems.length > 1) {
    showBanner(
      'is-ok',
      `โหลด ${batchItems.length} ภาพแล้ว — สุ่มเวลาห่างกัน 2–5 นาที และสุ่มพิกัดห่างกัน 5–10 เมตรต่อภาพเรียบร้อย (เลือกจุดหลักจากพิกัดที่บันทึกไว้หรือแผนที่ได้)`,
      [
        { label: 'พิกัดที่บันทึกไว้', onClick: () => openPresetsSheet() },
        { label: '🎲 สุ่มใหม่อีกครั้ง', onClick: () => rerollBatchSchedule() }
      ]
    );
    return;
  }

  showBanner(
    'is-warn',
    'รูปนี้ไม่มีพิกัด GPS (หรือถูกตัดออกตอนเลือกรูป) — ตอนนี้ใช้พิกัดเดิมอยู่ เลือกพิกัดใหม่ได้จากปุ่มด้านล่างหรือแผนที่ · เคล็ดลับ: เลือกรูปผ่าน "ไฟล์/Files" แทน "คลังรูปภาพ" มักได้พิกัดครบกว่า',
    [
      { label: 'GPS เครื่องนี้', onClick: () => requestDeviceLocation() },
      { label: 'พิกัดที่บันทึกไว้', onClick: () => openPresetsSheet() }
    ]
  );
}

/**
 * Single-file backward-compatible entrypoint.
 * @param {File} file
 * @param {{ fromCamera?: boolean, append?: boolean }} [opts]
 */
export async function handleImageFile(file, opts = {}) {
  if (!file) return;
  return handleImageFiles([file], opts);
}

// ---------------------------------------------------------------------------
// Place-name search
// ---------------------------------------------------------------------------

let placeSearchAbort = null;

function setPlaceSearchStatus(text) {
  if (!el.placeSearchStatus) return;
  el.placeSearchStatus.textContent = text;
  el.placeSearchStatus.hidden = !text;
}

function clearPlaceResults() {
  if (!el.placeResults) return;
  el.placeResults.innerHTML = '';
  el.placeResults.hidden = true;
}

async function runPlaceSearch() {
  const query = el.placeSearchInput?.value.trim() || '';
  clearPlaceResults();
  if (!query) {
    setPlaceSearchStatus('พิมพ์ชื่อสถานที่ก่อน');
    return;
  }
  // A pasted Google Maps link or "lat, lon" works here too
  if (parseLocationInput(query) || isShortMapUrl(query)) {
    if (applyLocationText(query, 'link')) setPlaceSearchStatus('');
    return;
  }
  el.placeSearchInput.blur(); // Hide the on-screen keyboard so the results are visible

  placeSearchAbort?.abort();
  placeSearchAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const q = query.toLowerCase();
  const saved = [...getDefaultPresets(), ...getCustomPresets()]
    .filter(p => p.name.toLowerCase().includes(q))
    .map(p => ({ ...p, detail: p.address || 'พิกัดที่บันทึกไว้', saved: true }));

  el.placeSearchBtn?.classList.add('is-busy');
  setPlaceSearchStatus('กำลังค้นหา…');
  let found = [];
  try {
    found = await searchPlaces(query, { limit: 6, signal: placeSearchAbort?.signal });
  } catch (err) {
    if (err?.name === 'AbortError') return;
  } finally {
    el.placeSearchBtn?.classList.remove('is-busy');
  }

  const results = [...saved, ...found];
  if (!results.length) {
    setPlaceSearchStatus(navigator.onLine === false
      ? 'ไม่มีอินเทอร์เน็ต — ค้นหาไม่ได้'
      : `ไม่พบ "${query}" — ลองพิมพ์ชื่ออื่น ใส่ชื่ออำเภอ/จังหวัดด้วย หรือแตะเลือกบนแผนที่`);
    return;
  }
  setPlaceSearchStatus(results.length === 1 ? '' : `พบ ${results.length} แห่ง — แตะเพื่อเลือก`);
  if (results.length === 1) {
    pickPlace(results[0]);
    return;
  }
  for (const place of results) {
    const li = document.createElement('li');
    li.className = 'preset-item';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'preset-pick';
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = place.saved ? `★ ${place.name}` : place.name;
    const meta = document.createElement('span');
    meta.className = 'preset-meta';
    meta.textContent = place.detail;
    pick.append(name, meta);
    pick.addEventListener('click', () => pickPlace(place));
    li.appendChild(pick);
    el.placeResults.appendChild(li);
  }
  el.placeResults.hidden = false;
}

function pickPlace(place) {
  clearPlaceResults();
  setPlaceSearchStatus(`เลือก: ${place.name}`);
  if (place.saved) applyPreset(place);
  else setLocation(place.lat, place.lon, 'search');
}

// ---------------------------------------------------------------------------
// Saved locations (presets)
// ---------------------------------------------------------------------------

export function renderPresetList() {
  if (!el.presetsList) return;
  // Built-in presets first (slot 1...), then the user's own; pad with empty slots up to PRESET_SLOT_COUNT
  const presets = [...getDefaultPresets(), ...getCustomPresets()];
  el.presetsList.innerHTML = '';
  if (el.presetsEmpty) el.presetsEmpty.hidden = true;

  const slotTotal = Math.max(PRESET_SLOT_COUNT, presets.length);
  for (let slot = 1; slot <= slotTotal; slot++) {
    const preset = presets[slot - 1];
    if (!preset) {
      el.presetsList.appendChild(createEmptyPresetSlot(slot));
      continue;
    }

    const li = document.createElement('li');
    li.className = 'preset-item';

    const num = document.createElement('span');
    num.className = 'preset-num';
    num.textContent = String(slot);
    li.appendChild(num);

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'preset-pick';
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name;
    const meta = document.createElement('span');
    meta.className = 'preset-meta mono';
    meta.textContent = `${formatCoordinates(preset.lat, preset.lon)}${preset.address ? ` · ${preset.address}` : ''}`;
    pick.append(name, meta);
    pick.addEventListener('click', () => {
      applyPreset(preset);
      closeSheet(el.presetsSheet);
    });
    li.appendChild(pick);

    if (!preset.isDefault) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'preset-delete';
      del.setAttribute('aria-label', `ลบ ${preset.name}`);
      del.textContent = '✕';
      del.addEventListener('click', () => {
        if (confirm(`ลบ "${preset.name}" ?`)) {
          deleteCustomPreset(preset.id);
          renderPresetList();
        }
      });
      li.appendChild(del);
    }

    el.presetsList.appendChild(li);
  }
}

let lastPresetPoint = null;

/** Uses a saved location, shifted a random 5–10 m so no two stamps share exact coordinates. */
function applyPreset(preset) {
  const point = jitterCoordinate(preset.lat, preset.lon, { avoid: lastPresetPoint });
  lastPresetPoint = { lat: point.lat, lon: point.lon };
  setLocation(point.lat, point.lon, 'preset', { address: preset.address });
  updateState({ selectedPresetId: preset.id });
}

function createEmptyPresetSlot(slot) {
  const li = document.createElement('li');
  li.className = 'preset-item is-empty';

  const num = document.createElement('span');
  num.className = 'preset-num';
  num.textContent = String(slot);

  const label = document.createElement('span');
  label.className = 'preset-empty-label';
  label.textContent = 'ว่าง — ยังไม่มีพิกัด';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-ghost btn-sm';
  save.textContent = 'บันทึกที่นี่';
  save.title = 'บันทึกพิกัดปัจจุบันลงช่องนี้';
  save.addEventListener('click', saveCurrentAsPreset);

  li.append(num, label, save);
  return li;
}

function openPresetsSheet() {
  renderPresetList();
  openSheet(el.presetsSheet);
}

function saveCurrentAsPreset() {
  const state = getState();
  const name = prompt('ตั้งชื่อพิกัดนี้', state.address || 'จุดบันทึก');
  if (!name || !name.trim()) return;
  const saved = saveCustomPreset({ name: name.trim(), lat: state.lat, lon: state.lon, address: state.address });
  if (saved) {
    renderPresetList();
    showToast(`บันทึก "${saved.name}" แล้ว`);
  } else {
    showToast('บันทึกไม่สำเร็จ (ชื่อยาวเกิน 100 ตัวอักษร?)');
  }
}

// ---------------------------------------------------------------------------
// Export (Single & Multi-Photo Batch)
// ---------------------------------------------------------------------------

function cleanupBatchExportUrls() {
  for (const item of batchExportResults) {
    if (item.url && item.url.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      try { URL.revokeObjectURL(item.url); } catch { /* ignore */ }
    }
  }
  batchExportResults = [];
}

async function runExport() {
  const state = getState();
  if (!state.image) {
    el.fileInput?.click();
    return;
  }

  // Save current edits on the active batch item before exporting
  if (batchItems[activeBatchIndex]) {
    batchItems[activeBatchIndex].dateTime = new Date(state.dateTime.getTime());
    batchItems[activeBatchIndex].lat = state.lat;
    batchItems[activeBatchIndex].lon = state.lon;
    batchItems[activeBatchIndex].address = state.address;
    batchItems[activeBatchIndex].userQuarterTurns = userQuarterTurns;
  }

  el.exportBtn.classList.add('is-busy');

  try {
    cleanupBatchExportUrls();
    const inApp = getInAppBrowserName();

    // Multi-photo batch export
    if (batchItems.length > 1) {
      for (let i = 0; i < batchItems.length; i++) {
        const item = batchItems[i];
        el.exportBtn.textContent = `กำลังสร้างภาพ ${i + 1}/${batchItems.length}…`;
        const itemData = {
          dateTimeStr: formatThaiBuddhistDate(item.dateTime),
          coordsStr: formatCoordinates(item.lat, item.lon),
          addressStr: item.address || state.address
        };
        const orient = getItemDrawOrientation(item.imageOrientation, item.userQuarterTurns);
        const blob = await exportFullResolution(item.image, itemData, {
          orientation: orient,
          quality: 0.92,
          mimeType: 'image/jpeg'
        });
        const filename = generateExportFilename(item.name, item.dateTime);
        const url = inApp ? await blobToDataUrl(blob) : URL.createObjectURL(blob);
        const file = new File([blob], filename, { type: 'image/jpeg' });
        batchExportResults.push({ blob, url, filename, file, dateTime: item.dateTime });
      }

      if (el.resultTitle) el.resultTitle.textContent = `สร้างครบ ${batchExportResults.length} ภาพแล้ว`;
      if (el.resultImage) el.resultImage.hidden = true;
      if (el.resultBatchGrid) {
        el.resultBatchGrid.hidden = false;
        el.resultBatchGrid.innerHTML = '';
        batchExportResults.forEach((res, idx) => {
          const card = document.createElement('div');
          card.className = 'result-batch-card';

          const img = document.createElement('img');
          img.className = 'result-batch-img';
          img.src = res.url;
          img.alt = `ภาพที่ ${idx + 1}`;

          const cap = document.createElement('div');
          cap.className = 'result-batch-caption';
          const label = document.createElement('span');
          label.className = 'mono';
          label.textContent = `#${idx + 1} · ${formatShortTime(res.dateTime)}`;

          const dl = document.createElement('a');
          dl.className = 'result-batch-dl';
          dl.href = res.url;
          dl.download = res.filename;
          dl.textContent = 'ดาวน์โหลด';

          cap.append(label, dl);
          card.append(img, cap);
          el.resultBatchGrid.appendChild(card);
        });
      }

      const allFiles = batchExportResults.map(r => r.file);
      const shareable = canUseWebShare(allFiles) || canUseWebShare(allFiles[0]);
      el.shareBtn.hidden = !shareable;
      el.shareBtn.textContent = `แชร์ / บันทึกทั้งหมด (${batchExportResults.length} ภาพ)`;

      el.downloadBtn.removeAttribute('href');
      el.downloadBtn.removeAttribute('download');
      el.downloadBtn.textContent = `ดาวน์โหลดทั้งหมด (${batchExportResults.length} ไฟล์)`;
      el.downloadBtn.hidden = !!inApp;

      if (inApp) {
        el.resultHint.textContent = getInAppSaveHint(inApp, shareable);
      } else {
        el.resultHint.textContent = shareable
          ? `กด "แชร์ / บันทึกทั้งหมด" แล้วเลือก Save ${batchExportResults.length} Images · หรือกดค้างที่รูปแต่ละใบ`
          : 'กด "ดาวน์โหลดทั้งหมด" เพื่อบันทึกไฟล์ลงเครื่อง';
      }

      openSheet(el.resultSheet);
      return;
    }

    // Single-photo export
    el.exportBtn.textContent = 'กำลังสร้างภาพ…';
    exportBlob = await exportFullResolution(state.image, getWatermarkData(state), {
      orientation: getDrawOrientation(),
      quality: 0.92,
      mimeType: 'image/jpeg'
    });
    exportFilename = generateExportFilename('', state.dateTime);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(exportBlob);

    if (el.resultTitle) el.resultTitle.textContent = 'ภาพพร้อมแล้ว';
    if (el.resultBatchGrid) {
      el.resultBatchGrid.hidden = true;
      el.resultBatchGrid.innerHTML = '';
    }
    if (el.resultImage) {
      el.resultImage.hidden = false;
      // In-app browsers save a long-pressed image by re-fetching its URL natively, which a blob: URL can't serve
      el.resultImage.src = inApp ? await blobToDataUrl(exportBlob) : exportUrl;
    }
    el.downloadBtn.href = exportUrl;
    el.downloadBtn.download = exportFilename;
    el.downloadBtn.textContent = 'ดาวน์โหลดไฟล์';
    el.downloadBtn.hidden = !!inApp;

    const file = new File([exportBlob], exportFilename, { type: 'image/jpeg' });
    const shareable = canUseWebShare(file);
    el.shareBtn.hidden = !shareable;
    el.shareBtn.textContent = 'แชร์ / บันทึกลงอัลบั้ม';
    if (inApp) {
      el.resultHint.textContent = getInAppSaveHint(inApp, shareable);
    } else {
      el.resultHint.textContent = shareable
        ? 'กด "แชร์ / บันทึกลงอัลบั้ม" แล้วเลือกบันทึกภาพ · หรือกดค้างที่รูป'
        : 'กด "ดาวน์โหลดไฟล์" เพื่อบันทึกภาพ';
    }
    openSheet(el.resultSheet);
  } catch (err) {
    console.error('[App] Export failed:', err);
    showToast('สร้างภาพไม่สำเร็จ: ' + (err?.message || err), 5000);
  } finally {
    el.exportBtn.classList.remove('is-busy');
    updateExportButtonLabel();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function getInAppSaveHint(appName, shareable) {
  const openOutside = isAppleMobile()
    ? 'กด ••• มุมขวาบน → "เปิดใน Safari"'
    : 'กด ⋮ มุมขวาบน → "เปิดในเบราว์เซอร์/Chrome"';
  const first = shareable ? 'กด "แชร์ / บันทึกลงอัลบั้ม" หรือ' : '';
  return `เบราว์เซอร์ของ ${appName} ดาวน์โหลดไฟล์ไม่ได้ — ${first}กดค้างที่รูปแล้วเลือก "บันทึกรูปภาพ" · ถ้ายังไม่ได้ ${openOutside} แล้วทำใหม่`;
}

async function shareExport() {
  if (batchExportResults.length > 1) {
    const files = batchExportResults.map(r => r.file);
    try {
      if (canUseWebShare(files)) {
        await shareFile(files, `Timestamp Photos (${files.length})`);
        return;
      }
      // Fallback if browser only supports single-file share
      for (const res of batchExportResults) {
        await shareFile(res.file, res.filename);
      }
      return;
    } catch (err) {
      const inApp = getInAppBrowserName();
      if (inApp) {
        showToast(getInAppSaveHint(inApp, false), 8000);
        return;
      }
      downloadAllBatchResults();
      return;
    }
  }

  if (!exportBlob) return;
  const file = new File([exportBlob], exportFilename, { type: 'image/jpeg' });
  try {
    await shareFile(file, exportFilename);
  } catch (err) {
    const inApp = getInAppBrowserName();
    if (inApp) {
      console.warn('[App] Share failed in in-app browser:', err);
      showToast(getInAppSaveHint(inApp, false), 8000);
      return;
    }
    console.warn('[App] Share failed, downloading instead:', err);
    downloadBlob(exportBlob, exportFilename);
  }
}

function downloadAllBatchResults() {
  if (!batchExportResults.length) return;
  batchExportResults.forEach((res, idx) => {
    setTimeout(() => {
      downloadBlob(res.blob, res.filename);
    }, idx * 220);
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function setupStateSubscription() {
  subscribe((state, changedKeys) => {
    if (changedKeys.some(k => ['image', 'dateTime', 'lat', 'lon', 'address'].includes(k))) {
      scheduleRepaint();
    }
    if (changedKeys.includes('image')) {
      if (el.placeholder) el.placeholder.hidden = !!state.image;
      if (el.rotateBtn) el.rotateBtn.disabled = !state.image;
    }
    if (changedKeys.includes('dateTime')) syncDateTimeControls(state);
    if (changedKeys.includes('isLiveTime') && el.liveToggle) el.liveToggle.checked = state.isLiveTime;
    if (changedKeys.some(k => k === 'lat' || k === 'lon')) syncLocationControls(state, changedKeys);
    syncAddressControls(state, changedKeys);
  });
}

export function setupEventListeners() {
  if (typeof document === 'undefined') return;

  // Photo inputs (Single or Multiple)
  el.fileInput?.addEventListener('change', (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length) handleImageFiles(files, { append: false });
  });
  el.addFilesInput?.addEventListener('change', (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length) handleImageFiles(files, { append: true });
  });
  el.cameraInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleImageFiles([file], { fromCamera: true, append: batchItems.length > 0 });
  });
  el.albumBtn?.addEventListener('click', () => el.fileInput?.click());
  el.replaceBtn?.addEventListener('click', () => el.fileInput?.click());
  el.addImagesBtn?.addEventListener('click', () => el.addFilesInput?.click());
  el.rerollBatchBtn?.addEventListener('click', () => rerollBatchSchedule());
  el.rotateBtn?.addEventListener('click', rotateImage);
  el.cameraBtn?.addEventListener('click', () => el.cameraInput?.click());

  // Date & time
  el.liveToggle?.addEventListener('change', (e) => setLiveTime(e.target.checked));
  el.datetimeInput?.addEventListener('change', applyCustomDateTimeFromInputs);
  el.secondsInput?.addEventListener('change', applyCustomDateTimeFromInputs);
  document.querySelectorAll('[data-shift-days], [data-shift-minutes]').forEach((chip) => {
    chip.addEventListener('click', () => shiftDateTime({
      days: Number(chip.dataset.shiftDays || 0),
      minutes: Number(chip.dataset.shiftMinutes || 0)
    }));
  });
  el.randomStepBtn?.addEventListener('click', stepRandomTimeAndCoord);
  el.exifTimeBtn?.addEventListener('click', () => {
    const d = getState().exifData?.dateTime;
    if (d) {
      setCustomDateTime(d);
      propagateDateTimeAcrossBatch(d);
    }
  });

  // Coordinates
  const onCoordInput = () => {
    // Allow pasting "lat, lon" into either box
    const latText = el.latInput.value.trim();
    if (latText.includes(',') && applyLocationText(latText, 'manual')) return;
    const lat = parseFloat(latText);
    const lon = parseFloat(el.lonInput.value.trim());
    const ok = isValidCoordinate(lat, lon);
    el.latInput.classList.toggle('is-invalid', !ok);
    el.lonInput.classList.toggle('is-invalid', !ok);
    if (ok) setLocation(lat, lon, 'manual');
  };
  el.latInput?.addEventListener('change', onCoordInput);
  el.lonInput?.addEventListener('change', onCoordInput);

  const onLinkSubmit = () => {
    if (applyLocationText(el.mapLinkInput.value, 'link')) el.mapLinkInput.value = '';
  };
  el.parseLinkBtn?.addEventListener('click', onLinkSubmit);
  el.mapLinkInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onLinkSubmit(); }
  });
  el.mapLinkInput?.addEventListener('paste', () => setTimeout(onLinkSubmit, 50));

  el.placeSearchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    runPlaceSearch();
  });

  el.gpsBtn?.addEventListener('click', () => requestDeviceLocation());
  el.presetsBtn?.addEventListener('click', openPresetsSheet);
  el.savePresetBtn?.addEventListener('click', saveCurrentAsPreset);

  // Address
  el.addressInput?.addEventListener('input', (e) => {
    addressToken++;
    setManualAddress(e.target.value);
    syncAddressAcrossBatch(e.target.value);
  });
  el.resetAddressBtn?.addEventListener('click', () => {
    unlockAddress();
    refreshAddress();
  });

  // Export
  el.exportBtn?.addEventListener('click', runExport);
  el.shareBtn?.addEventListener('click', shareExport);
  el.downloadBtn?.addEventListener('click', (e) => {
    if (batchExportResults.length > 1) {
      e.preventDefault();
      downloadAllBatchResults();
    }
  });

  // Sheets: close button + tap on backdrop
  document.querySelectorAll('dialog.sheet').forEach((dialog) => {
    dialog.querySelector('[data-close]')?.addEventListener('click', () => closeSheet(dialog));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeSheet(dialog);
    });
  });

  // Reset all
  el.resetAllBtn?.addEventListener('click', () => {
    if (getState().image && !confirm('ล้างรูปและค่าทั้งหมด?')) return;
    disposeBatchThumbnails(batchItems);
    batchItems = [];
    activeBatchIndex = 0;
    cleanupBatchExportUrls();
    resetDefaults();
    hideBanner();
    renderBatchStrip();
    if (el.exifTimeBtn) el.exifTimeBtn.hidden = true;
    const state = getState();
    setLocation(state.lat, state.lon, 'default');
  });
}

export async function init() {
  if (typeof document === 'undefined') return;

  el = queryDOMElements();

  loadWatermarkFonts().then(scheduleRepaint);

  setupStateSubscription();
  setupEventListeners();

  // Start from the last used location (falls back to the built-in default)
  const remembered = loadRememberedLocation();
  if (remembered) {
    updateCoordinates(remembered.lat, remembered.lon, { skipAddressUpdate: true });
    if (remembered.address) setAddress(remembered.address, false);
  }

  const state = getState();
  syncDateTimeControls(state);
  syncLocationControls(state, ['lat', 'lon']);
  syncAddressControls(state, ['address', 'isAddressManual']);
  renderCoordsSource(remembered ? 'last' : 'default');
  if (el.placeholder) el.placeholder.hidden = !!state.image;
  if (el.rotateBtn) el.rotateBtn.disabled = !state.image;
  renderBatchStrip();

  if (document.getElementById('map')) {
    initMap('map', { lat: state.lat, lon: state.lon, zoom: 15 }, ({ lat, lon, source }) => {
      if (source === 'marker_drag' || source === 'map_click') {
        setLocation(lat, lon, 'map', { zoom: false });
      }
    });
  }

  if (remembered?.address) {
    setTag(el.addressStatus, 'ใช้ล่าสุด', '');
  } else {
    refreshAddress();
  }

  startClock();
  scheduleRepaint();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
}
