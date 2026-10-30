/**
 * app.js
 *
 * UI wiring for Timestamp Camera Web.
 *
 * Flow:
 * 1. User picks / captures a photo.
 * 2. GPS in the photo's EXIF becomes the stamp location (lat/lon), and the location is
 *    reverse geocoded online (Google if a key is configured, otherwise OpenStreetMap)
 *    into "อ.<อำเภอ>, จ.<จังหวัด>".
 * 3. No GPS in the photo → keep the previous location and offer: device GPS, saved
 *    locations, map, or a pasted Google Maps link.
 * 4. Date/time is always chosen by the user (live clock, or any past/future value).
 * 5. Export renders the full-resolution JPEG, then a result sheet offers Share/Save
 *    (fresh tap keeps iOS Web Share happy) and a direct download.
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
import { getDefaultPresets, getCustomPresets, saveCustomPreset, deleteCustomPreset, jitterCoordinate, PRESET_SLOT_COUNT } from './presets.js';
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
let imageOrientation = 1;   // EXIF orientation the browser's decoder did NOT apply, so we draw it
let userQuarterTurns = 0;   // Extra clockwise 90° turns from the rotate button

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

    fileInput: $('file-input'),
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
    resultImage: $('result-image'),
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

function applyCustomDateTimeFromInputs() {
  const value = el.datetimeInput?.value || '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return;
  let seconds = parseInt(el.secondsInput?.value, 10);
  if (!Number.isFinite(seconds)) seconds = getState().dateTime.getSeconds();
  seconds = Math.min(59, Math.max(0, seconds));
  const [, y, mo, d, h, mi] = match.map(Number);
  const next = new Date(y, mo - 1, d, h, mi, seconds);
  if (!Number.isNaN(next.getTime())) setCustomDateTime(next);
}

function shiftDateTime({ days = 0, minutes = 0 }) {
  const base = new Date(getState().dateTime.getTime());
  if (days) base.setDate(base.getDate() + days);
  if (minutes) base.setMinutes(base.getMinutes() + minutes);
  setCustomDateTime(base);
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
      if (address) setAddress(address, false);
      lastSource = meta.source || 'offline';
      if (lastSource !== 'offline') {
        setTag(el.addressStatus, `จาก ${PROVIDER_LABELS[lastSource] || lastSource}`, 'is-ok');
        rememberLocation();
      }
    }
  }).then((finalAddress) => {
    if (token !== addressToken || getState().isAddressManual) return;
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
    setTag(el.addressStatus, 'จากพิกัดที่บันทึกไว้', 'is-accent');
    rememberLocation();
  } else {
    refreshAddress();
  }
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
// Photo loading
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

function getDrawOrientation() {
  for (const row of ORIENTATION_BY_TURNS) {
    const turns = row.indexOf(imageOrientation);
    if (turns >= 0) return row[(turns + userQuarterTurns) % 4];
  }
  return 1;
}

function rotateImage() {
  if (!getState().image) return;
  userQuarterTurns = (userQuarterTurns + 1) % 4;
  scheduleRepaint();
}

/**
 * @param {File} file
 * @param {{ fromCamera?: boolean }} [opts]
 */
export async function handleImageFile(file, opts = {}) {
  if (!file) return;

  const [exifResult, imageResult] = await Promise.allSettled([parseExif(file), decodeImage(file)]);

  if (imageResult.status !== 'fulfilled') {
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
    showToast(isHeic
      ? 'เบราว์เซอร์นี้เปิดไฟล์ HEIC ไม่ได้ — เปิดเว็บนี้บน iPhone (Safari) หรือแปลงรูปเป็น JPG ก่อน'
      : 'เปิดไฟล์รูปนี้ไม่ได้', 6000);
    return;
  }

  const exif = exifResult.status === 'fulfilled' ? exifResult.value : null;
  imageOrientation = await findUnappliedOrientation(file, exif?.orientation, imageResult.value);
  userQuarterTurns = 0;
  setImage(imageResult.value.image, file, file.name || 'photo.jpg');

  const exifDate = toValidDate(exif?.dateTime);
  updateState({
    exifData: exif?.hasExif ? {
      orientation: 1,
      dateTime: exifDate,
      latitude: exif.latitude ?? null,
      longitude: exif.longitude ?? null,
      altitude: exif.altitude ?? null
    } : null
  });
  if (el.exifTimeBtn) el.exifTimeBtn.hidden = !exifDate;

  const hasGps = typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number' &&
    isValidCoordinate(exif.latitude, exif.longitude) && !(exif.latitude === 0 && exif.longitude === 0);
  updateState({ hasExifGps: hasGps });

  if (hasGps) {
    setLocation(exif.latitude, exif.longitude, 'exif');
    const now = getState();
    showBanner('is-ok', `ใช้พิกัดจากรูป: ${formatCoordinates(now.lat, now.lon)} · ${now.address}`);
    // Banner text follows the address lookup
    const token = addressToken;
    const unsub = subscribe((state, keys) => {
      if (token !== addressToken) { unsub(); return; }
      if (keys.includes('address')) {
        el.bannerText.textContent = `ใช้พิกัดจากรูป: ${formatCoordinates(state.lat, state.lon)} · ${state.address}`;
      }
    });
    return;
  }

  if (opts.fromCamera) {
    showBanner('is-warn', 'รูปจากกล้องเว็บไม่มีพิกัดแนบมา กำลังใช้ GPS ของเครื่องแทน…');
    requestDeviceLocation({ quiet: true });
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

/** Uses a saved location, shifted a random 5–15 m so no two stamps share exact coordinates. */
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
// Export
// ---------------------------------------------------------------------------

async function runExport() {
  const state = getState();
  if (!state.image) {
    el.fileInput?.click();
    return;
  }

  el.exportBtn.classList.add('is-busy');
  el.exportBtn.textContent = 'กำลังสร้างภาพ…';
  try {
    exportBlob = await exportFullResolution(state.image, getWatermarkData(state), {
      orientation: getDrawOrientation(),
      quality: 0.92,
      mimeType: 'image/jpeg'
    });
    exportFilename = generateExportFilename('', state.dateTime);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(exportBlob);

    const inApp = getInAppBrowserName();
    // In-app browsers save a long-pressed image by re-fetching its URL natively, which a blob: URL can't serve
    el.resultImage.src = inApp ? await blobToDataUrl(exportBlob) : exportUrl;
    el.downloadBtn.href = exportUrl;
    el.downloadBtn.download = exportFilename;
    el.downloadBtn.hidden = !!inApp;

    const file = new File([exportBlob], exportFilename, { type: 'image/jpeg' });
    const shareable = canUseWebShare(file);
    el.shareBtn.hidden = !shareable;
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
    el.exportBtn.textContent = 'บันทึกภาพ';
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
  if (!exportBlob) return;
  const file = new File([exportBlob], exportFilename, { type: 'image/jpeg' });
  try {
    await shareFile(file, exportFilename);
  } catch (err) {
    const inApp = getInAppBrowserName();
    if (inApp) {
      // Downloads don't work here either; point to long-press / open in a real browser
      console.warn('[App] Share failed in in-app browser:', err);
      showToast(getInAppSaveHint(inApp, false), 8000);
      return;
    }
    console.warn('[App] Share failed, downloading instead:', err);
    downloadBlob(exportBlob, exportFilename);
  }
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

  // Photo inputs
  el.fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleImageFile(file);
  });
  el.cameraInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleImageFile(file, { fromCamera: true });
  });
  el.albumBtn?.addEventListener('click', () => el.fileInput?.click());
  el.replaceBtn?.addEventListener('click', () => el.fileInput?.click());
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
  el.exifTimeBtn?.addEventListener('click', () => {
    const d = getState().exifData?.dateTime;
    if (d) setCustomDateTime(d);
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
  });
  el.resetAddressBtn?.addEventListener('click', () => {
    unlockAddress();
    refreshAddress();
  });

  // Export
  el.exportBtn?.addEventListener('click', runExport);
  el.shareBtn?.addEventListener('click', shareExport);

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
    resetDefaults();
    hideBanner();
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
