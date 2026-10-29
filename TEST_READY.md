# Test Suite Readiness Declaration (TEST_READY.md)

**Project**: Timestamp Camera Web  
**Test Harness Status**: **READY FOR MILESTONE IMPLEMENTATION**  
**Date**: 2026-10-29  
**Test Runner**: Zero-dependency Node.js native runner (`node tests/test-runner.js`)  
**Test Philosophy**: Opaque-Box, Requirement-Driven, 100% Contract & Specification Verification  

---

## 1. Test Suite Summary

The automated test suite covering Tiers 1 to 4 is fully constructed, verified, and operational. It establishes strict, requirement-based behavioral contracts for all 22 application features defined in `PROJECT.md` and `ORIGINAL_REQUEST.md`.

```
=================== Overall Summary ===================
  Total Tests Built:    150 tests
  Execution Speed:      ~6 ms (clean CLI execution)
  Runtime Dependencies: 0 external dependencies (Pure Node.js built-ins)
  Current Pass Rate:    6 / 150 passed (Harness & environment validation)
  Pending Verification: 144 tests awaiting Milestones M1-M4 implementation
=======================================================
```

---

## 2. Test Tier Breakdown

| Tier | Category | Test Count | Scope & Coverage |
|:---:|:---|:---:|:---|
| **Tier 1** | **Feature Coverage** | **110 tests** | Covers all 22 features (>= 5 tests per feature). Validates static files, UI tokens, EXIF orientation/metadata, dual-canvas sizing, Thai Buddhist Era datetime, 6-decimal coordinates, Thai address structure, bundled Sarabun font, two-pass watermark styling, Leaflet map picker, coordinate inputs, map URL parser, dual-tier geocoder, manual address override, datetime controls, presets CRUD, Web Share export, and test runner CLI. |
| **Tier 2** | **Boundaries & Corner Cases** | **24 tests** | Mathematical boundaries (+/-90 lat, +/-180 lon, 0,0), leap year (29 ก.พ. 2567), century rollover (2100), New Year rollover (31 ธ.ค. -> 1 ม.ค.), midnight zero padding (00:00:00), complex Thai diacritics/lower vowels, XSS payloads in address, malformed map URLs, 100x100 thumbnails, extreme panoramic/vertical banners, 4K & 8K canvas scaling, and 8192px GPU canvas clamping. |
| **Tier 3** | **Cross-Feature Combinations** | **10 tests** | Pairwise state pipelines: EXIF auto-detection + state propagation; photo without EXIF fallback; Google Maps URL + reverse geocode + manual address lock; preset selection + map marker sync; live ticking time + map pan; custom preset bookmarking in localStorage; preset deletion safety; live clock + export snapshot freeze; sequential photo replacement; and Web Share fallback to anchor download. |
| **Tier 4** | **Realistic User Scenarios** | **6 scenarios** | End-to-end user workflows: (1) Reference scenario: Sukyang Road, Yala (`+6.499413,+101.267206`, `28 ต.ค. 2569 21:12:07`, `อ.เมืองยะลา, จ.ยะลา`); (2) Bangkok Grand Palace urban scenario (`เขตพระนคร, กรุงเทพมหานคร`); (3) Chiang Mai Doi Inthanon mountain scenario; (4) Phuket Patong Beach island scenario; (5) Foreign coordinates international handling; (6) Mobile field inspection patrol workflow with custom checkpoint title. |

---

## 3. How to Run the Tests

From the project directory (`d:\DEV\timestamp-camera-web`):

### Run Complete Test Suite
```bash
node tests/test-runner.js
```

### Run by Specific Tier
```bash
node tests/test-runner.js --tier=1
node tests/test-runner.js --tier=2
node tests/test-runner.js --tier=3
node tests/test-runner.js --tier=4
```

### Run with Verbose Diagnostics
```bash
node tests/test-runner.js --verbose
```

### Run with Pattern Filter
```bash
node tests/test-runner.js --filter="Sukyang"
```

---

## 4. Feature Coverage Matrix (All 22 Features)

| # | Feature Name | Milestone | Tier 1 Tests | Tier 2 | Tier 3 | Tier 4 |
|---|--------------|-----------|:------------:|:------:|:------:|:------:|
| 1 | Static Architecture & Zero-Backend | M4-DEPLOY | T1.1.1 - T1.1.5 | — | — | Scenario 1-6 |
| 2 | Mobile Responsive & Dark Camera UI | M3-UI | T1.2.1 - T1.2.5 | T2.20, T2.21 | — | Scenario 6 |
| 3 | Photo Album Upload | M3-UI | T1.3.1 - T1.3.5 | — | T3.1, T3.2 | Scenario 1 |
| 4 | Direct Camera Capture | M3-UI | T1.4.1 - T1.4.5 | — | — | Scenario 6 |
| 5 | EXIF Orientation Normalization | M1-CORE | T1.5.1 - T1.5.5 | — | T3.1 | Scenario 3 |
| 6 | EXIF Metadata Auto-Extraction | M1-CORE | T1.6.1 - T1.6.5 | — | T3.1 | Scenario 1 |
| 7 | Dual-Canvas High-Res Pipeline | M2-CANVAS | T1.7.1 - T1.7.5 | T2.19 - T2.24 | T3.8, T3.9 | Scenario 1-6 |
| 8 | Thai Buddhist Era Datetime Format | M1-CORE | T1.8.1 - T1.8.5 | T2.8 - T2.13 | T3.1, T3.8 | Scenario 1-6 |
| 9 | Signed 6-Decimal Coordinates | M1-CORE | T1.9.1 - T1.9.5 | T2.1 - T2.7 | T3.3, T3.4 | Scenario 1-6 |
| 10 | Thai Address Structure | M1-CORE | T1.10.1 - T1.10.5 | T2.15, T2.16 | T3.3 | Scenario 1-4 |
| 11 | Bundled Thai Sans-Serif Font | M2-CANVAS | T1.11.1 - T1.11.5 | — | — | Scenario 1 |
| 12 | Watermark Visual Styling | M2-CANVAS | T1.12.1 - T1.12.5 | T2.14, T2.17 | T3.8 | Scenario 1-6 |
| 13 | Proportional Watermark Sizing | M2-CANVAS | T1.13.1 - T1.13.5 | T2.19 - T2.23 | — | Scenario 1, 3 |
| 14 | Interactive Leaflet Map Picker | M3-UI | T1.14.1 - T1.14.5 | — | T3.4, T3.5 | Scenario 2, 4 |
| 15 | Manual Coordinate Inputs | M3-UI | T1.15.1 - T1.15.5 | T2.6 | T3.4 | Scenario 5 |
| 16 | Universal Map Link Parser | M1-CORE | T1.16.1 - T1.16.5 | T2.18 | T3.3 | Scenario 1 |
| 17 | Dual-Tier Thai Reverse Geocoding | M1-CORE | T1.17.1 - T1.17.5 | — | T3.3 | Scenario 1-4 |
| 18 | Manual Address Override | M3-UI | T1.18.1 - T1.18.5 | T2.15, T2.17 | T3.3 | Scenario 6 |
| 19 | Date & Time Controls | M3-UI | T1.19.1 - T1.19.5 | T2.8 - T2.12 | T3.5, T3.8 | Scenario 2 |
| 20 | Location Presets Management | M1-CORE | T1.20.1 - T1.20.5 | — | T3.4, T3.6, T3.7 | Scenario 1 |
| 21 | High-Res Export & Web Share | M3-UI | T1.21.1 - T1.21.5 | T2.24 | T3.10 | Scenario 6 |
| 22 | Comprehensive E2E Test Suite | E2E-TEST | T1.22.1 - T1.22.5 | — | — | — |

---

## 5. Implementation Guidance for Milestones

As implementation agents build out features in milestones M1-M4:
1. **Milestone M1-CORE**: Implementing `thai-datetime.js`, `coordinates.js`, `geocoder.js`, `presets.js`, and `exif-parser.js` will immediately flip Features 5, 6, 8, 9, 10, 16, 17, 20 from RED to GREEN.
2. **Milestone M2-CANVAS**: Implementing `font-loader.js` and `watermark-engine.js` will flip Features 7, 11, 12, 13 and all Tier 2 canvas scaling tests to GREEN.
3. **Milestone M3-UI**: Implementing `index.html`, `css/`, `map-picker.js`, `export-manager.js`, and `app.js` will turn Features 2, 3, 4, 14, 15, 18, 19, 21, Tier 3 combinations, and all Tier 4 user scenarios to GREEN.
4. **Milestone M4-DEPLOY**: Adding `.nojekyll`, PWA manifest, and final relative path audit will achieve 100% pass across all 150 tests.
