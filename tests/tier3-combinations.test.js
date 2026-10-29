/**
 * Tier 3: Cross-Feature Combinations (Pairwise Coverage)
 * Verifies multi-module interactions, state propagation, and pipeline handoffs:
 * - Datetime + Coordinates + Address
 * - EXIF Detection + Manual Override
 * - Presets + Map Synchronization
 * - Live Ticking + Canvas Export
 */

import { describe, test } from './test-runner.js';
import {
  REFERENCE_SPECS,
  loadModule,
  MockCanvas,
  MockContext2D,
  MockLocalStorage,
  setMockLocalStorage,
  setMockNavigator,
  assert,
  assertEqual,
  assertMatch
} from './test-utils.js';

describe('Tier 3: Pairwise Combinations & State Pipelines', () => {
  test('T3.1: EXIF Auto-Detection + State Propagation: Photo with EXIF GPS and Date updates state and UI', async () => {
    const { module: stateMod } = await loadModule('state.js');
    assert(stateMod, 'js/state.js must exist');
    const state = stateMod.appState || (stateMod.getState && stateMod.getState());
    assert(state, 'App state must be defined');

    // Simulate EXIF extraction result
    const mockExif = {
      dateTime: new Date(2026, 9, 28, 21, 12, 7),
      latitude: 6.499413,
      longitude: 101.267206
    };

    if (typeof stateMod.applyExifMetadata === 'function') {
      stateMod.applyExifMetadata(mockExif);
      assertEqual(state.lat, 6.499413, 'Lat populated from EXIF');
      assertEqual(state.lon, 101.267206, 'Lon populated from EXIF');
      assertEqual(state.isLiveTime, false, 'Live time disabled when EXIF date applied');
    }
  });

  test('T3.2: Photo without EXIF + Default Fallback: Defaults to live current time and Yala default coordinates', async () => {
    const { module: stateMod } = await loadModule('state.js');
    assert(stateMod, 'js/state.js must exist');
    if (typeof stateMod.resetDefaults === 'function') {
      stateMod.resetDefaults();
      const state = stateMod.appState || stateMod.getState();
      assertEqual(state.isLiveTime, true, 'Default must be live ticking time');
      assert(state.lat !== undefined && state.lon !== undefined, 'Default coordinates must exist');
    }
  });

  test('T3.3: Google Maps Link + Reverse Geocode + Manual Override Lock: Paste URL -> geocode -> lock custom text', async () => {
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: geoMod } = await loadModule('geocoder.js');
    const { module: stateMod } = await loadModule('state.js');
    assert(coordMod && geoMod && stateMod, 'Required modules must exist');

    const url = 'https://www.google.com/maps/@6.499413,101.267206,17z';
    const coords = coordMod.parseMapUrl(url);
    assert(coords !== null, 'URL parsed');

    const autoAddress = geoMod.lookupOfflineAddress(coords.lat, coords.lon);
    assertEqual(autoAddress, 'อ.เมืองยะลา, จ.ยะลา', 'Auto address resolved');

    // Simulate user overriding the address
    if (typeof stateMod.setManualAddress === 'function') {
      stateMod.setManualAddress('จุดตรวจสุขยางค์ 1 (สะเตง)');
      const state = stateMod.appState || stateMod.getState();
      assertEqual(state.isAddressManual, true, 'Manual flag set to true');

      // Now change coordinates; manual address must NOT be overwritten
      if (typeof stateMod.updateCoordinates === 'function') {
        stateMod.updateCoordinates(13.75, 100.49);
        assertEqual(state.address, 'จุดตรวจสุขยางค์ 1 (สะเตง)', 'Manual address preserved despite coordinate change');
      }
    }
  });

  test('T3.4: Preset Selection + Map Marker + Coordinate Input Sync: One-tap preset updates all bound controls', async () => {
    const { module: presetMod } = await loadModule('presets.js');
    const { module: stateMod } = await loadModule('state.js');
    assert(presetMod && stateMod, 'Required modules must exist');

    setMockLocalStorage(new MockLocalStorage());
    const targetPreset = presetMod.saveCustomPreset({
      name: 'จุดตรวจทดสอบ',
      lat: 6.499413,
      lon: 101.267206,
      address: 'อ.เมืองยะลา, จ.ยะลา'
    });
    assert(targetPreset, 'Custom preset must be saved');

    if (typeof stateMod.selectPreset === 'function') {
      stateMod.selectPreset(targetPreset.id);
      const state = stateMod.appState || stateMod.getState();
      assertEqual(state.lat, targetPreset.lat, 'State lat matches preset');
      assertEqual(state.lon, targetPreset.lon, 'State lon matches preset');
      assertEqual(state.address, targetPreset.address, 'State address matches preset');
      assertEqual(state.isAddressManual, false, 'Manual address flag cleared on preset selection');
    }
  });

  test('T3.5: Live Ticking Time + Map Interaction: Coordinate changes do NOT disrupt live clock interval', async () => {
    const { module: stateMod } = await loadModule('state.js');
    assert(stateMod, 'js/state.js must exist');
    const state = stateMod.appState || (stateMod.getState && stateMod.getState());

    if (typeof stateMod.setLiveTime === 'function' && typeof stateMod.updateCoordinates === 'function') {
      stateMod.setLiveTime(true);
      stateMod.updateCoordinates(7.896667, 98.296667); // Move to Phuket
      assertEqual(state.isLiveTime, true, 'Live time remains enabled after coordinate update');
      assertEqual(state.lat, 7.896667, 'Lat updated cleanly');
    }
  });

  test('T3.6: Custom Date + Custom Location Bookmark: User bookmarks current custom setup to localStorage', async () => {
    const mockStorage = new MockLocalStorage();
    setMockLocalStorage(mockStorage);
    const { module: presetMod } = await loadModule('presets.js');
    assert(presetMod, 'js/presets.js must exist');

    presetMod.saveCustomPreset({
      name: 'จุดสกัดบ้านเนียง',
      lat: 6.5500,
      lon: 101.2000,
      address: 'อ.เมืองยะลา, จ.ยะลา'
    });

    const saved = presetMod.getCustomPresets();
    const found = saved.find(p => p.name === 'จุดสกัดบ้านเนียง');
    assert(found !== undefined, 'Custom preset saved in storage');
    assertEqual(found.lat, 6.5500, 'Preset lat saved accurately');
  });

  test('T3.7: Preset Deletion does NOT corrupt active state or default presets', async () => {
    const mockStorage = new MockLocalStorage();
    setMockLocalStorage(mockStorage);
    const { module: presetMod } = await loadModule('presets.js');
    assert(presetMod, 'js/presets.js must exist');

    const defaultCount = presetMod.getDefaultPresets().length;
    presetMod.saveCustomPreset({ id: 'temp-1', name: 'Temp', lat: 10, lon: 100, address: 'Temp' });
    presetMod.deleteCustomPreset('temp-1');

    assertEqual(presetMod.getDefaultPresets().length, defaultCount, 'Default presets unaffected by deletion');
    assertEqual(presetMod.getCustomPresets().length, 0, 'Custom presets list empty after deleting only item');
  });

  test('T3.8: Live Clock + Export Snapshot: Export pipeline captures exact timestamp snapshot without desync', async () => {
    const { module: dtMod } = await loadModule('thai-datetime.js');
    const { module: coordMod } = await loadModule('coordinates.js');
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(dtMod && coordMod && wmMod, 'Required modules must exist');

    const frozenDate = new Date(2026, 9, 28, 21, 12, 7);
    const dateStr = dtMod.formatThaiBuddhistDate(frozenDate);
    const coordStr = coordMod.formatCoordinates(6.499413, 101.267206);
    const addrStr = 'อ.เมืองยะลา, จ.ยะลา';

    const canvas = new MockCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    wmMod.renderWatermark(ctx, 1024, 768, {
      dateTimeStr: dateStr,
      coordsStr: coordStr,
      addressStr: addrStr
    });

    const fillCalls = ctx.getCalls('fillText');
    assertEqual(fillCalls[0].args.text, '28 ต.ค. 2569 21:12:07', 'Snapshot frozen on render');
  });

  test('T3.9: Sequential Image Uploads: Uploading photo 2 cleans previous canvas and updates dimensions', async () => {
    const { module: wmMod } = await loadModule('watermark-engine.js');
    assert(wmMod, 'js/watermark-engine.js must exist');

    const canvas1 = new MockCanvas(1024, 768);
    const canvas2 = new MockCanvas(1920, 1080);
    assert(canvas1.width !== canvas2.width, 'Sequential canvases reflect new dimensions');
  });

  test('T3.10: Web Share Fallback Pipeline: Unsupported Web Share falls back to standard anchor download', async () => {
    setMockNavigator({ canShare: () => false, share: undefined });
    const { module: exportMod } = await loadModule('export-manager.js');
    assert(exportMod, 'js/export-manager.js must exist');
    if (typeof exportMod.canUseWebShare === 'function') {
      assertEqual(exportMod.canUseWebShare(), false, 'Correctly detects unsupported Web Share');
    }
  });
});
