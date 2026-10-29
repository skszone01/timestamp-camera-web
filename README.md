# Timestamp Camera Web (กล้องประทับเวลาและพิกัดไทย)

> A 100% client-side, zero-backend static web application deployable directly to **GitHub Pages**. Embeds pixel-faithful Timestamp Camera watermarks matching Thai official and professional field standards.

---

## 🌟 Key Capabilities

- **EXIF GPS first**: เลือกรูป → ดึงพิกัดจาก EXIF ของรูป → หาอำเภอ/จังหวัดออนไลน์ → ตั้งเป็นตราประทับให้ทันที
- **ไม่มีพิกัดในรูป?** เลือกได้จาก GPS เครื่อง, พิกัดที่บันทึกไว้, แตะบนแผนที่ Google, หรือวางลิงก์ Google Maps / ตัวเลขพิกัด
- **วันเวลาเลือกเอง**: เวลาปัจจุบัน (เดินตามนาฬิกา) หรือกำหนดเองทั้งย้อนหลัง/อนาคต พร้อมช่องวินาที, ปุ่ม ±1 ชม./±1 วัน, และ "ใช้เวลาในรูป"
- **Thai Buddhist Era (พ.ศ.)** `28 ต.ค. 2569 21:12:07`, พิกัด 6 ตำแหน่ง `+6.499413,+101.267206`, ที่อยู่ `อ.เมืองยะลา, จ.ยะลา`
- **Reverse geocoding**: OpenStreetMap Nominatim (ฟรี ไม่ต้องมี key) หรือ Google Geocoding ถ้าใส่ key ใน `js/config.js`; มีตารางออฟไลน์สำรองเมื่อไม่มีเน็ต
- **แผนที่**: Leaflet + Google แผนที่ / Google ดาวเทียม / OpenStreetMap สลับได้
- **Export**: JPEG ความละเอียดเต็ม (จำกัด ≤16 MP เพื่อให้ iPhone ทำงานได้) → แชร์/บันทึกลงอัลบั้ม (Web Share) หรือดาวน์โหลด
- **100% client-side**: รูปไม่ถูกอัปโหลดไปไหน

> หมายเหตุพิกัดในรูป: iOS/Android อาจตัดข้อมูลตำแหน่งออกเมื่อเลือกรูปผ่าน "คลังรูปภาพ" ของเบราว์เซอร์ และรูปที่ถ่ายผ่านปุ่ม "ถ่ายรูปใหม่" ในเว็บมักไม่มีพิกัด — เว็บจะใช้ GPS ของเครื่องแทนให้อัตโนมัติ

## 🔖 เพิ่มพิกัดใช้บ่อย

- **ในหน้าเว็บ**: ปุ่ม "พิกัดที่บันทึกไว้" → "+ บันทึกพิกัดปัจจุบัน" (เก็บใน localStorage ของเครื่องนั้น)
- **ฝังมากับเว็บ (ทุกเครื่องเห็น)**: เพิ่มรายการใน `DEFAULT_PRESETS` ที่ `js/presets.js` (มีตัวอย่างในคอมเมนต์)

## 🔑 ใช้ Google หาอำเภอ/จังหวัด (ไม่บังคับ)

ใส่ key ใน `js/config.js` → `GOOGLE_GEOCODING_API_KEY` (ต้องเปิด Geocoding API + billing และจำกัด key ให้ใช้ได้เฉพาะโดเมน `*.github.io` ของคุณ) ถ้าเว้นว่างจะใช้ OpenStreetMap

---

## 🚀 GitHub Pages Deployment Guide

Deploying Timestamp Camera Web to GitHub Pages takes under 2 minutes:

### Step 1: Push Repository to GitHub
Ensure the repository contains the static files at root:
```bash
git add .
git commit -m "Deploy Timestamp Camera Web to GitHub Pages"
git push origin main
```

### Step 2: Configure GitHub Pages Settings
1. On GitHub, navigate to your repository.
2. Click **Settings** (⚙️) -> **Pages** (under Code and automation in the left sidebar).
3. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`.
   - **Branch**: Select `main` (or your default branch) and folder `/ (root)`.
   - Click **Save**.
4. GitHub Pages will build and publish your site at:
   ```
   https://<username>.github.io/<repository-name>/
   ```

### Why `.nojekyll` is Crucial
GitHub Pages executes Jekyll by default, which ignores folders beginning with `_` and can alter static asset delivery. The `.nojekyll` file at the repository root instructs GitHub Pages to bypass Jekyll processing entirely and serve pure static files as-is.

### Relative Path Portability
Every asset link in `index.html`, `manifest.json`, CSS, and JavaScript uses relative paths (`./` or relative to the current directory). This guarantees that the application runs identically on:
- Root domains: `https://camera.example.com/`
- GitHub Pages project subpaths: `https://username.github.io/timestamp-camera-web/`
- Local web servers: `http://localhost:8080/`

---

## 📱 Mobile PWA Installation

Timestamp Camera Web meets Progressive Web App (PWA) standards for standalone full-screen experience:

### iOS (Safari)
1. Open the deployed URL in Safari.
2. Tap the **Share** button (rectangle with arrow pointing up).
3. Scroll down and tap **Add to Home Screen** (เพิ่มไปยังหน้าจอโฮม).
4. Tap **Add**. The app opens as a standalone full-screen camera app with native feel.

### Android (Chrome / Edge / Samsung Internet)
1. Open the deployed URL in Chrome.
2. Tap the **Install** banner or three dots (⋮) menu -> **Install app** (ติดตั้งแอป).
3. The app is installed on your app launcher with full offline capabilities.

---

## 📁 Repository Structure

```
timestamp-camera-web/
├── .nojekyll                   # Disables Jekyll processing on GitHub Pages
├── index.html                  # Main responsive single-page web shell
├── manifest.json               # Progressive Web App manifest
├── README.md                   # Deployment and operational documentation
├── css/
│   ├── main.css                # Base reset, typography, theme variables
│   ├── components.css          # Cards, buttons, inputs, controls, map
│   └── responsive.css          # Mobile safe-area insets & media queries
├── js/
│   ├── app.js                  # Application lifecycle & event coordinator
│   ├── state.js                # Centralized state management
│   ├── thai-datetime.js        # Thai Buddhist Era datetime engine
│   ├── coordinates.js          # GPS coordinate parsing & formatting
│   ├── geocoder.js             # Dual-tier Thai reverse geocoder
│   ├── presets.js              # Curated & custom bookmark presets
│   ├── exif-parser.js          # EXIF metadata parser & orientation
│   ├── font-loader.js          # Sarabun font loader & readiness check
│   ├── watermark-engine.js     # Two-pass canvas watermark renderer
│   ├── map-picker.js           # Leaflet map picker & vector SVG pin
│   └── export-manager.js       # Web Share API & high-res image download
├── assets/
│   ├── fonts/                  # Bundled WOFF2 fonts (no external CDN required)
│   │   ├── Sarabun-Regular.woff2
│   │   └── Sarabun-Medium.woff2
│   └── icons/                  # PWA and browser icons
│       ├── favicon.svg
│       ├── icon.svg
│       ├── icon-192.png
│       ├── icon-512.png
│       └── apple-touch-icon.png
├── vendor/
│   └── leaflet/                # Self-contained Leaflet 1.9.4 library
│       ├── leaflet.js
│       └── leaflet.css
└── tests/                      # Automated multi-tier test suite
    ├── test-runner.js
    ├── tier1-features.test.js
    ├── tier2-boundaries.test.js
    ├── tier3-combinations.test.js
    └── tier4-scenarios.test.js
```

---

## 🛠️ Local Development & Testing

Run a local static web server from the repository root:

```bash
# Using Python 3:
python -m http.server 8080

# Or using npx serve:
npx serve .
```

Visit `http://localhost:8080/` in your browser.

### Automated Test Runner
Run the zero-dependency Node.js test suite:
```bash
node tests/test-runner.js
```

---

## 📄 License
MIT License.
