# Timestamp Camera Web — Test Infrastructure & Philosophy (TEST_INFRA.md)

## 1. Test Philosophy

### Opaque-Box & Requirement-Driven Design
The test suite for Timestamp Camera Web is engineered strictly as an **opaque-box, contract-driven test system**. Tests are decoupled from internal private implementation variables, unexported helper functions, and specific DOM structure details. Instead, tests assert against:
1. **Public Interface Contracts**: Explicitly defined in `PROJECT.md § Interface Contracts` (`formatThaiBuddhistDate`, `formatCoordinates`, `parseMapUrl`, `lookupOfflineAddress`, `getDefaultPresets`, `renderWatermark`, etc.).
2. **Authoritative Specification & Reference Material**: The user requirements in `ORIGINAL_REQUEST.md` and the visual layout measurements from the reference photo (`media_1793282555436_8b59e9be.jpg`):
   - Line 1: Thai Buddhist Era Datetime (`DD มมม YYYY HH:mm:ss`, BE = CE + 543)
   - Line 2: Signed 6-decimal coordinates (`+latitude,+longitude`)
   - Line 3: Thai administrative address (`อ.<district>, จ.<province>`)
   - Bottom-right corner placement, right-aligned (`textAlign = 'right'`), two-pass rendering (dark shadowed stroke + pure white fill).
   - Proportional scaling tied to `minDim = Math.min(width, height)`: font size 3.65%, line pitch 1.30, right margin 4.6%, bottom margin 4.7%.
3. **Observability & Determinism**: All test inputs map to deterministic, verifiable outputs with zero reliance on non-deterministic external network calls during offline execution.

### Independence & Isolation
Every test is fully isolated and self-contained:
- Tests instantiate fresh mock environments (canvas, storage, navigator) and clear all state before and after execution.
- No test depends on the execution order or side-effects of another test.
- Zero external test runner framework dependencies: the suite runs on standard Node.js (v18+) without requiring Jest, Mocha, or npm install.

---

## 2. Test Architecture & Runner

### Directory Structure
```
d:\DEV\timestamp-camera-web/
├── TEST_INFRA.md               # This specification
├── TEST_READY.md               # Readiness declaration & summary
└── tests/
    ├── test-runner.js          # Lightweight zero-dependency test runner
    ├── test-utils.js           # Headless mocks (Canvas2D, LocalStorage, Navigator) & assertions
    ├── tier1-features.test.js  # Tier 1: Isolated feature coverage (>= 5 tests per feature)
    ├── tier2-boundaries.test.js# Tier 2: Boundary & edge case coverage
    ├── tier3-combinations.test.js# Tier 3: Pairwise cross-feature combinations
    └── tier4-scenarios.test.js # Tier 4: Realistic end-to-end user scenarios
```

### Zero-Dependency Test Runner Execution
The test runner is built in `tests/test-runner.js` using Node.js built-ins (`node:assert`, `node:path`, `node:url`, `node:process`).

#### Running All Tests
```bash
node tests/test-runner.js
```

#### Running Specific Tiers
```bash
node tests/test-runner.js --tier=1
node tests/test-runner.js --tier=2
node tests/test-runner.js --tier=3
node tests/test-runner.js --tier=4
```

#### Running with Verbose Output
```bash
node tests/test-runner.js --verbose
```

### Dynamic Module Loading & Graceful Contract Assertion
The test runner features a dynamic contract loader (`test-utils.js:loadModule`) that:
- Inspects whether an implementation module exists in `js/`.
- If a module is pending implementation (e.g. during early milestone phases), the runner cleanly flags the specific feature test with an actionable contract failure rather than crashing the process with uncaught Node loader errors.
- As implementing agents complete milestones (M1-CORE, M2-CANVAS, M3-UI), the tests automatically exercise the real modules and transition to PASS.

---

## 3. Feature Inventory Coverage Map (All 22 Features)

| Feature # | Feature Name | Tier 1 (Isolated) | Tier 2 (Boundaries) | Tier 3 (Combinations) | Tier 4 (Scenarios) |
|---|---|---|---|---|---|
| **F01** | Static Architecture & Zero-Backend | T1.1.1 - T1.1.5 | Empty/missing asset checks | Build asset validation | GitHub Pages root deploy |
| **F02** | Mobile Responsive & Dark Camera UI | T1.2.1 - T1.2.5 | Extreme aspect ratios (9:21, 1:1) | Responsive resize + UI state | Mobile viewport inspection |
| **F03** | Photo Album Upload | T1.3.1 - T1.3.5 | Corrupted blobs, 0-byte files | Album upload + EXIF read | User gallery upload |
| **F04** | Direct Camera Capture | T1.4.1 - T1.4.5 | Camera access permission denial | Capture + immediate watermark | Field patrol shutter tap |
| **F05** | EXIF Orientation Normalization | T1.5.1 - T1.5.5 | Orientation tags 1-8, missing EXIF | Orientation + canvas scaling | Smartphone portrait shot |
| **F06** | EXIF Metadata Auto-Extraction | T1.6.1 - T1.6.5 | Stripped headers, partial GPS | EXIF date + manual coord edit | Real camera JPEG with GPS |
| **F07** | Dual-Canvas High-Res Pipeline | T1.7.1 - T1.7.5 | 4K (3840x2160), 8K (7680x4320) | 1280px preview + full-res export | 12MP-48MP photo download |
| **F08** | Thai Buddhist Era Datetime Format | T1.8.1 - T1.8.5 | Leap year (29 Feb), New Year, midnight | Date picker + live clock | Yala 28 ต.ค. 2569 reference |
| **F09** | Signed 6-Decimal Coordinates | T1.9.1 - T1.9.5 | Poles (+/-90), IDL (+/-180), 0,0 | Map pin drop + manual entry | +6.499413,+101.267206 |
| **F10** | Thai Address Structure | T1.10.1 - T1.10.5 | Special chars, long strings, Bangkok | Reverse geocode + edit lock | อ.เมืองยะลา, จ.ยะลา |
| **F11** | Bundled Thai Sans-Serif Font | T1.11.1 - T1.11.5 | Missing font fallback, timeout | Font load + canvas render | Sarabun WOFF2 rendering |
| **F12** | Watermark Visual Styling | T1.12.1 - T1.12.5 | White background, dark background | Two-pass stroke + white fill | Reference visual overlay |
| **F13** | Proportional Watermark Sizing | T1.13.1 - T1.13.5 | 100x100 thumbnail, 8K ultra-wide | minDim scaling on portrait/land | Reference 1024x768 (28px) |
| **F14** | Interactive Leaflet Map Picker | T1.14.1 - T1.14.5 | Invalid lat/lon pan, offline tiles | Map tap + marker drag | Leaflet OSM interaction |
| **F15** | Manual Coordinate Inputs | T1.15.1 - T1.15.5 | Out of range coords, NaN, text | Input sync with map marker | Manual typing coordinate |
| **F16** | Universal Map Link Parser | T1.16.1 - T1.16.5 | Malformed URLs, query strings | Link paste + address lookup | Google / Apple / OSM links |
| **F17** | Dual-Tier Thai Reverse Geocoding | T1.17.1 - T1.17.5 | Disconnected network, timeout | Tier 1 offline -> Tier 2 OSM | Instant offline 77 provinces |
| **F18** | Manual Address Override | T1.18.1 - T1.18.5 | Blank address, HTML tags, emoji | Dirty flag lock on pin drag | Custom location naming |
| **F19** | Date & Time Controls | T1.19.1 - T1.19.5 | Invalid date string, future dates | Live clock toggle + custom edit | Datetime picker interaction |
| **F20** | Location Presets Management | T1.20.1 - T1.20.5 | Storage quota full, corrupt JSON | Save preset + select + delete | 8 curated Thai presets |
| **F21** | High-Res Export & Web Share | T1.21.1 - T1.21.5 | Web Share unsupported / denied | Share file -> fallback download | Mobile camera roll save |
| **F22** | Comprehensive E2E Test Suite | T1.22.1 - T1.22.5 | Exit codes, CLI argument filtering | Summary reporting across tiers | Full suite CI execution |

---

## 4. Test Tier Descriptions

### Tier 1: Feature Coverage (Isolated Functional Tests)
- **Target**: >= 5 tests per feature across all 22 features (minimum 110 tests).
- **Scope**: Verifies individual module functions, public methods, and DOM/HTML requirements in complete isolation.
- **Verification**: Tests verify exact contract inputs and outputs without cross-feature dependencies.

### Tier 2: Boundary & Corner Cases
- **Target**: Edge conditions, limits, stress points, and invalid inputs (minimum 25 tests).
- **Scope**:
  - Coordinate limits (`[-90, +90]`, `[-180, +180]`, `(0, 0)`, poles, international dateline).
  - Datetime limits (Leap year Feb 29, century rollover, midnight `00:00:00`, noon `12:00:00`, CE to BE offset).
  - Text & Encoding (Thai diacritics, above/below vowels `สระอุ/สระอู`, tone marks `ไม้เอก/ไม้โท`, script injection strings).
  - Image Resolutions (100x100 thumbnails, 1080p, 4K, 8K ultra-wide, GPU canvas memory limits).

### Tier 3: Cross-Feature Combinations (Pairwise Coverage)
- **Target**: Multi-module workflows and state transitions (minimum 15 tests).
- **Scope**:
  - Image upload + EXIF auto-detection + manual coordinate override.
  - Google Maps link pasting + offline reverse geocoding + manual address lock.
  - Live ticking time + custom preset selection + full-res canvas export.
  - Storage persistence + preset CRUD + map marker synchronization.

### Tier 4: Realistic End-User Application Scenarios
- **Target**: Complete end-to-end user workflows matching real-world use cases (minimum 6 scenarios).
- **Scope**:
  1. **Sukyang Road, Yala Reference Scenario**: Verifies exact visual and textual match to reference photo (`+6.499413,+101.267206`, `28 ต.ค. 2569 21:12:07`, `อ.เมืองยะลา, จ.ยะลา`).
  2. **Bangkok Grand Palace Urban Scenario**: Verifies Bangkok district formatting (`เขตพระนคร, กรุงเทพมหานคร`).
  3. **Chiang Mai Doi Inthanon Mountain Scenario**: Verifies northern province mountain summit coordinates.
  4. **Phuket Patong Beach Island Scenario**: Verifies southern coastal island coordinates.
  5. **Foreign Coordinates Scenario**: Verifies graceful international handling outside Thailand.
  6. **Mobile Field Inspector Checkpoint Scenario**: Simulates complete user workflow from camera capture to custom checkpoint name and high-resolution export.
