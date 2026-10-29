/**
 * map-picker.js
 * 
 * Interactive Leaflet Map Picker & Coordinate Synchronization Engine
 * for Timestamp Camera Web.
 * 
 * Features:
 * - Touch-friendly Leaflet 1.9.4 map integration with OpenStreetMap standard tiles
 * - Zero external image dependencies: 100% self-contained vector SVG DivIcon
 *   marker pin with radar pulse wave animation and crisp retina rendering
 * - Bi-directional coordinate synchronization between map marker, text inputs,
 *   location presets, EXIF metadata, and camera watermark engine
 * - Drag-and-drop marker positioning (`marker.on('dragend')`)
 * - Tap-to-pin direct map click navigation (`map.on('click')`)
 * - High-accuracy GPS geolocation button (`navigator.geolocation.getCurrentPosition`)
 * - Universal Map Link & DMS coordinate string parsing integration
 * - Dual-tier reverse geocoding integration with manual address edit lock protection
 * - Responsive container handling with automatic ResizeObserver invalidateSize()
 * - Headless Node.js test-runner resilience (safe evaluation in non-DOM environments)
 */

import { isValidCoordinate, formatCoordinates, parseLocationInput } from './coordinates.js';
import { resolveThaiAddress } from './geocoder.js';
import { DEFAULT_MAP_LAYER } from './config.js';

// Default reference coordinates: Sukyang Road, Yala (reference photo location)
export const DEFAULT_COORDINATES = Object.freeze({
  lat: 6.499413,
  lon: 101.267206,
  zoom: 16
});

// OSM Standard Tile configuration
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

// Google Maps raster tiles (Thai labels). lyrs: m = roadmap, y = hybrid (satellite + labels)
const GOOGLE_TILE_URL = 'https://mt{s}.google.com/vt/lyrs={lyrs}&hl=th&x={x}&y={y}&z={z}';
const GOOGLE_ATTRIBUTION = 'Map data &copy; Google';

export const MAP_LAYERS = Object.freeze({
  google: { label: 'Google แผนที่', url: GOOGLE_TILE_URL, options: { lyrs: 'm', subdomains: '0123', maxZoom: 21, attribution: GOOGLE_ATTRIBUTION } },
  'google-hybrid': { label: 'Google ดาวเทียม', url: GOOGLE_TILE_URL, options: { lyrs: 'y', subdomains: '0123', maxZoom: 21, attribution: GOOGLE_ATTRIBUTION } },
  osm: { label: 'OpenStreetMap', url: OSM_TILE_URL, options: { maxNativeZoom: 19, maxZoom: 21, attribution: OSM_ATTRIBUTION, detectRetina: true } }
});

// Module-level state tracking
let mapInstance = null;
let markerInstance = null;
let tileLayerInstance = null;
let resizeObserverInstance = null;
let currentCoords = { lat: DEFAULT_COORDINATES.lat, lon: DEFAULT_COORDINATES.lon };
let changeCallbacks = new Set();
let clickCallbacks = new Set();
let isManualAddressLocked = false;

/**
 * Generates the raw SVG markup for the custom high-visibility map marker pin.
 * Features:
 * - Scalable vector teardrop pin (32x42px) with sharp pointer at bottom tip [16, 42]
 * - Dual-layer radial gradient fill (crimson/coral red) with white outer contour
 * - Inner concentric target dot for precise optical alignment
 * - Embedded SVG drop-shadow filter for high contrast on light/dark cartography
 * - Concentric radar pulse ring at the coordinate anchor point
 * 
 * @param {Object} [options]
 * @param {string} [options.pinColor='#ff3b30'] - Primary pin color
 * @param {string} [options.pulseColor='rgba(255, 59, 48, 0.45)'] - Radar wave color
 * @returns {string} HTML markup string for L.divIcon
 */
export function getPinSvgMarkup(options = {}) {
  const pinColor = options.pinColor || '#ff3b30';
  const pulseColor = options.pulseColor || 'rgba(255, 59, 48, 0.45)';

  return `
    <div class="tc-pin-wrapper" style="position:relative;width:32px;height:42px;user-select:none;-webkit-user-select:none;">
      <div class="tc-pin-pulse" style="
        position:absolute;
        bottom:-6px;
        left:50%;
        transform:translateX(-50%);
        width:18px;
        height:9px;
        border-radius:50%;
        background:${pulseColor};
        animation:tcPinPulseAnim 2s cubic-bezier(0.2, 0.8, 0.4, 1) infinite;
        pointer-events:none;
        z-index:1;
      "></div>
      <svg class="tc-pin-svg" viewBox="0 0 32 42" width="32" height="42" fill="none" xmlns="http://www.w3.org/2000/svg" style="
        position:relative;
        z-index:2;
        filter:drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
        transition:transform 0.15s ease-out;
        display:block;
      ">
        <path d="M16 0C7.163 0 0 7.163 0 16C0 25.5 16 42 16 42C16 42 32 25.5 32 16C32 7.163 24.837 0 16 0Z"
              fill="${pinColor}"
              stroke="#ffffff"
              stroke-width="1.5"
              stroke-linejoin="round"/>
        <circle cx="16" cy="16" r="6.5" fill="#ffffff"/>
        <circle cx="16" cy="16" r="3" fill="${pinColor}"/>
      </svg>
    </div>
  `.trim();
}

/**
 * Creates a Leaflet DivIcon instance using the self-contained SVG pin.
 * Avoids any external image asset requests (eliminates Leaflet 404 marker image errors).
 * 
 * @param {Object} [options]
 * @returns {Object} L.divIcon instance in browser, or descriptor object in headless Node.js
 */
export function createPinIcon(options = {}) {
  const html = getPinSvgMarkup(options);
  const iconConfig = {
    className: options.className || 'tc-leaflet-custom-pin',
    html: html,
    iconSize: options.iconSize || [32, 42],
    iconAnchor: options.iconAnchor || [16, 42],
    popupAnchor: options.popupAnchor || [0, -42]
  };

  const L_ref = options.L || (typeof window !== 'undefined' ? window.L : (typeof globalThis !== 'undefined' ? globalThis.L : null));

  if (L_ref && typeof L_ref.divIcon === 'function') {
    return L_ref.divIcon(iconConfig);
  }

  // Graceful fallback descriptor for headless Node.js test-runner
  return iconConfig;
}

/**
 * Internal notification dispatcher for coordinate change subscribers.
 * 
 * @param {number} lat
 * @param {number} lon
 * @param {Object} [meta] - Context information ({ source, accuracy, zoomTo })
 */
function notifyCoordinateChange(lat, lon, meta = {}) {
  currentCoords = { lat, lon };
  const payload = {
    lat,
    lon,
    coordsString: formatCoordinates(lat, lon),
    source: meta.source || 'programmatic',
    ...meta
  };

  for (const callback of changeCallbacks) {
    try {
      callback(payload);
    } catch (err) {
      console.error('Error in coordinate change listener:', err);
    }
  }
}

/**
 * Initializes the Leaflet map within the specified container element or ID.
 * 
 * @param {string|HTMLElement} container - DOM element or container ID (e.g. 'map')
 * @param {Object} [initialCoords] - { lat, lon, zoom }
 * @param {Function} [onChangeCallback] - Listener receiving { lat, lon, coordsString, source }
 * @returns {Object|null} Map controller object, or null in non-DOM environments
 */
export function initMap(container, initialCoords = {}, onChangeCallback = null) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // Headless / Node.js test environment guard
    if (typeof onChangeCallback === 'function') {
      changeCallbacks.add(onChangeCallback);
    }
    return null;
  }

  const L_ref = window.L || globalThis.L;
  if (!L_ref || typeof L_ref.map !== 'function') {
    console.warn('Leaflet library (L) is not loaded. Map initialization deferred.');
    return null;
  }

  // Resolve container element
  const containerEl = typeof container === 'string' ? document.getElementById(container) : container;
  if (!containerEl) {
    console.error('Map container element not found:', container);
    return null;
  }

  // Clean up existing map instance if already initialized on this container
  if (mapInstance) {
    destroyMap();
  }

  const startLat = Number.isFinite(initialCoords.lat) ? initialCoords.lat : DEFAULT_COORDINATES.lat;
  const startLon = Number.isFinite(initialCoords.lon) ? initialCoords.lon : DEFAULT_COORDINATES.lon;
  const startZoom = Number.isFinite(initialCoords.zoom) ? initialCoords.zoom : DEFAULT_COORDINATES.zoom;

  currentCoords = { lat: startLat, lon: startLon };

  if (typeof onChangeCallback === 'function') {
    changeCallbacks.add(onChangeCallback);
  }

  // Inject animation CSS rule for the pulse effect if not already present
  injectPinPulseStyles();

  // Initialize Leaflet Map
  mapInstance = L_ref.map(containerEl, {
    center: [startLat, startLon],
    zoom: startZoom,
    minZoom: 3,
    maxZoom: 21,
    zoomControl: false, // Custom or repositioned controls
    attributionControl: true
  });

  // Add repositioned zoom control to bottom-right (better mobile ergonomics)
  L_ref.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

  // Base layers: Google roadmap / Google hybrid / OSM, switchable from the top-right control
  const baseLayers = {};
  for (const [key, def] of Object.entries(MAP_LAYERS)) {
    const layer = L_ref.tileLayer(def.url, def.options);
    baseLayers[def.label] = layer;
    if (key === (MAP_LAYERS[DEFAULT_MAP_LAYER] ? DEFAULT_MAP_LAYER : 'google')) {
      tileLayerInstance = layer;
    }
  }
  tileLayerInstance.addTo(mapInstance);
  L_ref.control.layers(baseLayers, null, { position: 'topright' }).addTo(mapInstance);

  // Create custom SVG DivIcon
  const pinIcon = createPinIcon({ L: L_ref });

  // Create draggable marker
  markerInstance = L_ref.marker([startLat, startLon], {
    icon: pinIcon,
    draggable: true,
    autoPan: true,
    autoPanPadding: [20, 20]
  }).addTo(mapInstance);

  // Wire Marker Drag Events
  markerInstance.on('dragend', (e) => {
    const latlng = e.target.getLatLng();
    const cleanLat = parseFloat(latlng.lat.toFixed(6));
    const cleanLon = parseFloat(latlng.lng.toFixed(6));
    notifyCoordinateChange(cleanLat, cleanLon, { source: 'marker_drag' });
  });

  // Wire Map Click / Tap Events
  mapInstance.on('click', (e) => {
    const cleanLat = parseFloat(e.latlng.lat.toFixed(6));
    const cleanLon = parseFloat(e.latlng.lng.toFixed(6));

    if (markerInstance) {
      markerInstance.setLatLng([cleanLat, cleanLon]);
    }

    notifyCoordinateChange(cleanLat, cleanLon, { source: 'map_click' });

    for (const cb of clickCallbacks) {
      try {
        cb({ lat: cleanLat, lon: cleanLon });
      } catch (err) {
        console.error('Error in onMapClick listener:', err);
      }
    }
  });

  // Setup ResizeObserver for automatic container size invalidation
  // (handles responsive layout resizing, mobile drawer expansion, orientation change)
  if (typeof ResizeObserver !== 'undefined' && containerEl) {
    resizeObserverInstance = new ResizeObserver(() => {
      if (mapInstance) {
        mapInstance.invalidateSize();
      }
    });
    resizeObserverInstance.observe(containerEl);
  }

  // Initial size invalidation after microtask to account for initial CSS rendering
  setTimeout(() => {
    if (mapInstance) {
      mapInstance.invalidateSize();
    }
  }, 100);

  return {
    map: mapInstance,
    marker: markerInstance,
    setCoordinates: setMapCoordinates,
    getCoordinates: getMapCoordinates,
    panTo,
    invalidateSize,
    locateUser,
    destroy: destroyMap
  };
}

/**
 * Updates the map marker position and optionally pans/zooms the map view.
 * 
 * @param {number} lat - Latitude in decimal degrees [-90, 90]
 * @param {number} lon - Longitude in decimal degrees [-180, 180]
 * @param {boolean} [zoomTo=false] - Whether to center the map on the new position
 * @param {Object} [meta] - Metadata passed to change subscribers
 * @returns {{ lat: number, lon: number }|null}
 */
export function setMapCoordinates(lat, lon, zoomTo = false, meta = {}) {
  const numLat = typeof lat === 'number' ? lat : parseFloat(lat);
  const numLon = typeof lon === 'number' ? lon : parseFloat(lon);

  if (!isValidCoordinate(numLat, numLon)) {
    return null;
  }

  const cleanLat = parseFloat(numLat.toFixed(6));
  const cleanLon = parseFloat(numLon.toFixed(6));
  currentCoords = { lat: cleanLat, lon: cleanLon };

  if (markerInstance && typeof markerInstance.setLatLng === 'function') {
    markerInstance.setLatLng([cleanLat, cleanLon]);
  }

  if (mapInstance) {
    if (zoomTo) {
      const targetZoom = Math.max(mapInstance.getZoom() || 16, 16);
      mapInstance.setView([cleanLat, cleanLon], targetZoom, { animate: true });
    } else {
      // If outside current visible bounds, smoothly pan to marker
      const bounds = mapInstance.getBounds();
      if (bounds && !bounds.contains([cleanLat, cleanLon])) {
        mapInstance.panTo([cleanLat, cleanLon], { animate: true });
      }
    }
  }

  if (meta.silent !== true) {
    notifyCoordinateChange(cleanLat, cleanLon, {
      source: meta.source || 'set_coordinates',
      zoomTo
    });
  }

  return { lat: cleanLat, lon: cleanLon };
}

/**
 * Alias for setMapCoordinates to fulfill test harness contracts.
 * @param {number} lat
 * @param {number} lon
 * @param {boolean} [zoomTo=false]
 * @returns {{ lat: number, lon: number }|null}
 */
export function setMarkerPosition(lat, lon, zoomTo = false) {
  return setMapCoordinates(lat, lon, zoomTo);
}

/**
 * Returns the current active coordinates from the map marker.
 * @returns {{ lat: number, lon: number }}
 */
export function getMapCoordinates() {
  if (markerInstance && typeof markerInstance.getLatLng === 'function') {
    const pos = markerInstance.getLatLng();
    return {
      lat: parseFloat(pos.lat.toFixed(6)),
      lon: parseFloat(pos.lng.toFixed(6))
    };
  }
  return { ...currentCoords };
}

/**
 * Pans the map view to a specific coordinate location.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [zoom]
 */
export function panTo(lat, lon, zoom = null) {
  if (!isValidCoordinate(lat, lon)) return;
  if (mapInstance && typeof mapInstance.panTo === 'function') {
    if (typeof zoom === 'number' && typeof mapInstance.setView === 'function') {
      mapInstance.setView([lat, lon], zoom, { animate: true });
    } else {
      mapInstance.panTo([lat, lon], { animate: true });
    }
  }
}

/**
 * Triggers Leaflet's invalidateSize() to recalculate tile grid dimensions.
 * Critical when map container expands from bottom sheet or changes orientation.
 */
export function invalidateSize() {
  if (mapInstance && typeof mapInstance.invalidateSize === 'function') {
    mapInstance.invalidateSize();
  }
}

/**
 * Registers a map click listener callback.
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function onMapClick(callback) {
  if (typeof callback === 'function') {
    clickCallbacks.add(callback);
    return () => clickCallbacks.delete(callback);
  }
  return () => {};
}

/**
 * Registers a coordinate change listener callback.
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function onCoordinateChange(callback) {
  if (typeof callback === 'function') {
    changeCallbacks.add(callback);
    return () => changeCallbacks.delete(callback);
  }
  return () => {};
}

/**
 * Requests high-accuracy device location via the Geolocation API ("Locate Me" button).
 * Pans the map and marker to the user's current GPS position upon success.
 * 
 * @param {Object} [options]
 * @param {number} [options.timeout=10000] - GPS timeout in milliseconds
 * @param {boolean} [options.enableHighAccuracy=true] - Hardware GPS request flag
 * @param {Function} [options.onSuccess] - Callback on location resolved
 * @param {Function} [options.onError] - Callback on error
 * @returns {Promise<{ lat: number, lon: number, accuracy: number }>}
 */
export function locateUser(options = {}) {
  const opts = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 30000,
    ...options
  };

  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const err = new Error('Geolocation is not supported by your browser.');
      if (typeof opts.onError === 'function') opts.onError(err);
      return reject(err);
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const rawLat = position.coords.latitude;
        const rawLon = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        const cleanLat = parseFloat(rawLat.toFixed(6));
        const cleanLon = parseFloat(rawLon.toFixed(6));

        setMapCoordinates(cleanLat, cleanLon, true, {
          source: 'geolocation',
          accuracy
        });

        const result = { lat: cleanLat, lon: cleanLon, accuracy };
        if (typeof opts.onSuccess === 'function') opts.onSuccess(result);
        resolve(result);
      },
      (geoError) => {
        let message = 'Unable to determine your location.';
        switch (geoError.code) {
          case 1: // PERMISSION_DENIED
            message = 'Location access was denied. Please enable location permissions in browser settings.';
            break;
          case 2: // POSITION_UNAVAILABLE
            message = 'GPS signal unavailable. Please ensure location services are turned on.';
            break;
          case 3: // TIMEOUT
            message = 'GPS location request timed out. Please try again.';
            break;
        }

        const err = new Error(message);
        err.code = geoError.code;
        if (typeof opts.onError === 'function') opts.onError(err);
        reject(err);
      },
      opts
    );
  });
}

/**
 * Parses user pasted string (Google Maps, Apple Maps, OSM URL, or coordinate text)
 * and moves the map marker if valid coordinates are found.
 * 
 * @param {string} inputString - URL or coordinate pair string
 * @returns {{ lat: number, lon: number }|null} Resolved coordinates or null
 */
export function handleUrlPaste(inputString) {
  if (!inputString || typeof inputString !== 'string') return null;

  const parsed = parseLocationInput(inputString);
  if (parsed && isValidCoordinate(parsed.lat, parsed.lon)) {
    setMapCoordinates(parsed.lat, parsed.lon, true, { source: 'url_paste' });
    return parsed;
  }
  return null;
}

/**
 * Wires bi-directional synchronization between DOM input elements and the map.
 * Supports:
 * - Latitude text input
 * - Longitude text input
 * - Universal link/search text input (auto-detects map URLs and DMS strings)
 * 
 * @param {Object} elements
 * @param {HTMLInputElement} [elements.latInput]
 * @param {HTMLInputElement} [elements.lonInput]
 * @param {HTMLInputElement} [elements.searchOrUrlInput]
 * @param {Function} [onChange] - Additional change listener
 * @returns {Function} Cleanup function to unbind all listeners
 */
export function bindCoordinateInputs(elements = {}, onChange = null) {
  const { latInput, lonInput, searchOrUrlInput } = elements;
  const unbinders = [];

  // Update inputs whenever map marker moves
  const unsubCoord = onCoordinateChange(({ lat, lon }) => {
    if (latInput && document.activeElement !== latInput) {
      latInput.value = lat >= 0 ? `+${lat.toFixed(6)}` : lat.toFixed(6);
    }
    if (lonInput && document.activeElement !== lonInput) {
      lonInput.value = lon >= 0 ? `+${lon.toFixed(6)}` : lon.toFixed(6);
    }
    if (typeof onChange === 'function') {
      onChange({ lat, lon });
    }
  });
  unbinders.push(unsubCoord);

  // Sync Latitude input changes to map
  const onLatChange = () => {
    if (!latInput || !lonInput) return;
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    if (isValidCoordinate(lat, lon)) {
      setMapCoordinates(lat, lon, false, { source: 'input_change' });
    }
  };

  // Sync Longitude input changes to map
  const onLonChange = () => {
    if (!latInput || !lonInput) return;
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    if (isValidCoordinate(lat, lon)) {
      setMapCoordinates(lat, lon, false, { source: 'input_change' });
    }
  };

  if (latInput) {
    latInput.addEventListener('change', onLatChange);
    latInput.addEventListener('blur', onLatChange);
    unbinders.push(() => {
      latInput.removeEventListener('change', onLatChange);
      latInput.removeEventListener('blur', onLatChange);
    });
  }

  if (lonInput) {
    lonInput.addEventListener('change', onLonChange);
    lonInput.addEventListener('blur', onLonChange);
    unbinders.push(() => {
      lonInput.removeEventListener('change', onLonChange);
      lonInput.removeEventListener('blur', onLonChange);
    });
  }

  // Sync Universal search/URL input
  if (searchOrUrlInput) {
    const onSearchChange = () => {
      const val = searchOrUrlInput.value.trim();
      if (!val) return;
      const parsed = handleUrlPaste(val);
      if (parsed) {
        searchOrUrlInput.value = ''; // Clear after successful parse
      }
    };

    searchOrUrlInput.addEventListener('change', onSearchChange);
    searchOrUrlInput.addEventListener('paste', () => {
      setTimeout(onSearchChange, 50);
    });
    unbinders.push(() => {
      searchOrUrlInput.removeEventListener('change', onSearchChange);
    });
  }

  return () => {
    for (const unbind of unbinders) {
      unbind();
    }
  };
}

/**
 * Manages manual address lock state.
 * When locked, automatic geocoder updates must NOT overwrite user's custom address text.
 * 
 * @param {boolean} locked
 */
export function setManualAddressLock(locked) {
  isManualAddressLocked = Boolean(locked);
}

/**
 * Returns whether manual address lock is active.
 * @returns {boolean}
 */
export function isManualAddressLockedState() {
  return isManualAddressLocked;
}

/**
 * Helper to trigger dual-tier reverse geocoding on current marker position,
 * respecting the manual address edit lock.
 * 
 * @param {Object} [options]
 * @param {Function} [options.onAddressUpdate] - Callback receiving address strings
 * @returns {Promise<string>}
 */
export function refreshAddress(options = {}) {
  const coords = getMapCoordinates();
  return resolveThaiAddress(coords.lat, coords.lon, {
    isAddressManual: isManualAddressLocked,
    onUpdate: options.onAddressUpdate
  });
}

/**
 * Completely tears down the Leaflet map, removing DOM listeners, layers,
 * and ResizeObserver to prevent memory leaks.
 */
export function destroyMap() {
  if (resizeObserverInstance) {
    resizeObserverInstance.disconnect();
    resizeObserverInstance = null;
  }

  if (markerInstance) {
    markerInstance.remove();
    markerInstance = null;
  }

  if (tileLayerInstance) {
    tileLayerInstance.remove();
    tileLayerInstance = null;
  }

  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  changeCallbacks.clear();
  clickCallbacks.clear();
}

/**
 * Injects CSS keyframe animation for the marker pulse ring into document head.
 */
function injectPinPulseStyles() {
  if (typeof document === 'undefined') return;
  const styleId = 'tc-leaflet-pin-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .tc-leaflet-custom-pin {
      background: transparent !important;
      border: none !important;
    }
    @keyframes tcPinPulseAnim {
      0% {
        transform: translateX(-50%) scale(0.6);
        opacity: 0.85;
      }
      65% {
        transform: translateX(-50%) scale(2.5);
        opacity: 0;
      }
      100% {
        transform: translateX(-50%) scale(2.5);
        opacity: 0;
      }
    }
    .tc-pin-wrapper:hover .tc-pin-svg {
      transform: scale(1.08) translateY(-2px);
    }
  `;
  document.head.appendChild(style);
}
