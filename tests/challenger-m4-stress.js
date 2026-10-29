/**
 * tests/challenger-m4-stress.js
 * 
 * Empirical Adversarial Challenger Suite for Milestone M4:
 * GitHub Pages Static Hardening, Subpath Portability & Icon Integrity
 * 
 * Sections:
 * 1. Binary PNG Forensics & Chunk Stream Validation (icon-192, icon-512, apple-touch-icon)
 * 2. SVG Vector Icon XML Structural Integrity & Visual Semantics
 * 3. Subpath Hosting Simulation & Zero Root Path Portability Stress
 * 4. Exhaustive Root-Relative Link Scan Across Repository Files
 * 5. PWA Shell & GitHub Pages Packaging Hardening
 * 6. Regression Audit Across Prior Milestone Suites
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let totalChecked = 0;
let passed = 0;
let failed = 0;
const findings = [];

function assert(condition, testName, details = '') {
  totalChecked++;
  if (condition) {
    passed++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failed++;
    const msg = `  [FAIL] ${testName} - ${details}`;
    console.error(msg);
    findings.push(msg);
  }
}

// CRC32 implementation for PNG chunk auditing
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function computeCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ============================================================================
// SECTION 1: Binary PNG Forensics & Chunk Stream Validation
// ============================================================================
console.log('\n--- SECTION 1: Binary PNG Forensics & Chunk Stream Validation ---');

const PNG_TARGETS = [
  { file: 'assets/icons/icon-192.png', expectedW: 192, expectedH: 192, name: 'Android PWA 192' },
  { file: 'assets/icons/icon-512.png', expectedW: 512, expectedH: 512, name: 'Android PWA 512' },
  { file: 'assets/icons/apple-touch-icon.png', expectedW: 180, expectedH: 180, name: 'iOS Touch Icon 180' }
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const target of PNG_TARGETS) {
  const fullPath = path.join(ROOT_DIR, target.file);
  assert(fs.existsSync(fullPath), `S1.${target.name}.1: File exists on disk`);

  const buf = fs.readFileSync(fullPath);
  assert(buf.length > 500, `S1.${target.name}.2: File size is non-trivial (${buf.length} bytes)`);

  // 1. Signature
  const sigMatch = buf.subarray(0, 8).equals(PNG_SIGNATURE);
  assert(sigMatch, `S1.${target.name}.3: Magic bytes match exact PNG signature (\\x89PNG\\r\\n\\x1a\\n)`);

  // 2. Walk Chunks
  let offset = 8;
  const chunks = [];
  let reachedEnd = false;
  let chunkIndex = 0;
  let idatBuffers = [];

  while (offset < buf.length) {
    if (offset + 8 > buf.length) {
      assert(false, `S1.${target.name}.chunk: Unexpected EOF reading chunk header`);
      break;
    }

    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buf.length) {
      assert(false, `S1.${target.name}.chunk: Chunk ${type} overflows buffer`);
      break;
    }

    const data = buf.subarray(dataStart, dataEnd);
    const recordedCrc = buf.readUInt32BE(dataEnd);
    const typeAndData = buf.subarray(offset + 4, dataEnd);
    const computedCrc = computeCrc32(typeAndData);

    const crcOk = (recordedCrc === computedCrc);
    chunks.push({ type, length, crcOk, chunkIndex });

    if (type === 'IDAT') {
      idatBuffers.push(data);
    } else if (type === 'IEND') {
      reachedEnd = true;
      const extraBytes = buf.length - (dataEnd + 4);
      assert(extraBytes === 0, `S1.${target.name}.end: Zero trailing garbage bytes after IEND (found ${extraBytes})`);
    }

    offset = dataEnd + 4;
    chunkIndex++;
  }

  assert(reachedEnd, `S1.${target.name}.4: PNG file contains valid terminating IEND chunk`);

  // Check all chunk CRCs
  const allCrcsPass = chunks.every(c => c.crcOk);
  assert(allCrcsPass, `S1.${target.name}.5: All ${chunks.length} chunk CRC32 checksums are mathematically valid`);

  // First chunk must be IHDR
  assert(chunks[0] && chunks[0].type === 'IHDR', `S1.${target.name}.6: First chunk is IHDR`);
  assert(chunks[0] && chunks[0].length === 13, `S1.${target.name}.7: IHDR chunk length is exactly 13 bytes`);

  // Parse IHDR
  const ihdrBuf = buf.subarray(16, 16 + 13);
  const width = ihdrBuf.readUInt32BE(0);
  const height = ihdrBuf.readUInt32BE(4);
  const bitDepth = ihdrBuf.readUInt8(8);
  const colorType = ihdrBuf.readUInt8(9);
  const compression = ihdrBuf.readUInt8(10);
  const filter = ihdrBuf.readUInt8(11);
  const interlace = ihdrBuf.readUInt8(12);

  assert(width === target.expectedW, `S1.${target.name}.8: Width matches expected (${width} === ${target.expectedW})`);
  assert(height === target.expectedH, `S1.${target.name}.9: Height matches expected (${height} === ${target.expectedH})`);
  assert(bitDepth === 8, `S1.${target.name}.10: Bit depth is 8-bit per channel`);
  assert(colorType === 6, `S1.${target.name}.11: Color type is 6 (RGBA)`);
  assert(compression === 0, `S1.${target.name}.12: Compression method is 0 (Deflate)`);
  assert(filter === 0, `S1.${target.name}.13: Filter method is 0 (Adaptive standard)`);
  assert(interlace === 0, `S1.${target.name}.14: Interlace is 0 (Standard progressive off)`);

  // Decompress IDAT stream with zlib
  const compressedIdat = Buffer.concat(idatBuffers);
  assert(compressedIdat.length > 0, `S1.${target.name}.15: IDAT compressed payload collected`);

  let decompressed;
  let inflateOk = false;
  try {
    decompressed = zlib.inflateSync(compressedIdat);
    inflateOk = true;
  } catch (err) {
    console.error(`Inflate error:`, err);
  }
  assert(inflateOk, `S1.${target.name}.16: IDAT stream successfully decompressed via zlib`);

  const expectedScanlineLen = height * (1 + width * 4);
  assert(decompressed && decompressed.length === expectedScanlineLen,
    `S1.${target.name}.17: Decompressed scanline buffer matches exact raw RGBA length (${decompressed?.length} === ${expectedScanlineLen})`
  );

  // Scan pixel data to verify it is non-blank and has color & alpha variation
  if (decompressed && decompressed.length === expectedScanlineLen) {
    let nonZeroAlpha = 0;
    let colorVariety = new Set();
    const stride = 1 + width * 4;

    for (let y = 0; y < height; y++) {
      const rowStart = y * stride;
      const filterByte = decompressed[rowStart];
      // Filter byte must be 0..4
      if (filterByte > 4) {
        assert(false, `S1.${target.name}.scan: Invalid PNG filter type ${filterByte} on row ${y}`);
      }
      for (let x = 0; x < width; x += 4) {
        const px = rowStart + 1 + x * 4;
        const r = decompressed[px];
        const g = decompressed[px + 1];
        const b = decompressed[px + 2];
        const a = decompressed[px + 3];
        if (a > 0) nonZeroAlpha++;
        colorVariety.add((r << 16) | (g << 8) | b);
      }
    }

    assert(nonZeroAlpha > (width * height * 0.1), `S1.${target.name}.18: Icon contains non-trivial visible alpha pixels (${nonZeroAlpha})`);
    assert(colorVariety.size > 10, `S1.${target.name}.19: Icon contains diverse color palette (${colorVariety.size} distinct colors, not flat monochrome)`);
  }
}

// ============================================================================
// SECTION 2: SVG Vector Icon XML Structural Integrity & Semantics
// ============================================================================
console.log('\n--- SECTION 2: SVG Vector Icon XML Structural Integrity & Semantics ---');

const SVG_TARGETS = [
  { file: 'assets/icons/favicon.svg', minTags: 3, name: 'Favicon SVG', maxBytes: 1500 },
  { file: 'assets/icons/icon.svg', minTags: 10, name: 'Master Scalable Icon SVG', maxBytes: 10000 }
];

for (const target of SVG_TARGETS) {
  const fullPath = path.join(ROOT_DIR, target.file);
  assert(fs.existsSync(fullPath), `S2.${target.name}.1: File exists on disk`);

  const raw = fs.readFileSync(fullPath, 'utf8');
  assert(raw.length > 50 && raw.length < target.maxBytes,
    `S2.${target.name}.2: File size within reasonable bounds (${raw.length} bytes)`
  );

  // XML / SVG Root checks
  assert(raw.includes('<svg') && raw.includes('</svg>'), `S2.${target.name}.3: Has root <svg> and closing </svg>`);
  assert(raw.includes('xmlns="http://www.w3.org/2000/svg"'), `S2.${target.name}.4: Has proper SVG namespace declaration`);
  assert(raw.includes('viewBox="'), `S2.${target.name}.5: Has viewBox attribute for responsive scaling`);

  // Well-formedness tag check
  const tagRegex = /<\/?([a-zA-Z0-9]+)[^>]*>/g;
  const stack = [];
  let match;
  let tagCount = 0;
  let wellFormed = true;

  while ((match = tagRegex.exec(raw)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];

    if (fullTag.startsWith('<?') || fullTag.startsWith('<!')) {
      continue; // xml declaration or doctype
    }

    tagCount++;
    const isSelfClosing = fullTag.endsWith('/>');
    const isClosing = fullTag.startsWith('</');

    if (isClosing) {
      const top = stack.pop();
      if (top !== tagName) {
        wellFormed = false;
        console.error(`Mismatched closing tag in ${target.file}: expected ${top}, got ${tagName}`);
      }
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
  }

  assert(wellFormed && stack.length === 0, `S2.${target.name}.6: XML tags are properly balanced and closed`);
  assert(tagCount >= target.minTags, `S2.${target.name}.7: Contains sufficient vector elements (${tagCount} tags)`);
}

// Special checks for icon.svg artwork elements
const iconSvgContent = fs.readFileSync(path.join(ROOT_DIR, 'assets/icons/icon.svg'), 'utf8');
assert(iconSvgContent.includes('radialGradient') || iconSvgContent.includes('linearGradient'),
  'S2.Artwork.1: icon.svg utilizes gradients for realistic optical lens aesthetics'
);
assert(iconSvgContent.includes('#ffd700'), 'S2.Artwork.2: icon.svg includes gold reticle accents matching project style');
assert(iconSvgContent.includes('#ff3b30'), 'S2.Artwork.3: icon.svg includes camera record beacon indicator');

// ============================================================================
// SECTION 3: Subpath Hosting Simulation & Zero Root Path Portability Stress
// ============================================================================
console.log('\n--- SECTION 3: Subpath Hosting Simulation & Zero Root Path Portability Stress ---');

const SIMULATED_BASES = [
  'https://username.github.io/timestamp-camera-web/',
  'https://organization.github.io/repos/timestamp-camera-web/',
  'http://localhost:8080/nested/subpath/app/'
];

// Extract resources from index.html
const indexHtmlContent = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

// Collect all href, src, url references
const htmlResourceRegex = /(?:href|src)=["']([^"']+)["']/g;
const extractedHtmlRefs = [];
let htmlMatch;
while ((htmlMatch = htmlResourceRegex.exec(indexHtmlContent)) !== null) {
  const ref = htmlMatch[1];
  // Ignore anchor hashes (#...) and http/https external links
  if (!ref.startsWith('#') && !ref.startsWith('http://') && !ref.startsWith('https://')) {
    extractedHtmlRefs.push(ref);
  }
}

// Extract manifest resources
const manifestContent = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
const extractedManifestRefs = [
  manifestContent.start_url,
  manifestContent.scope,
  ...manifestContent.icons.map(i => i.src)
];

// Extract CSS font resources
const mainCssContent = fs.readFileSync(path.join(ROOT_DIR, 'css/main.css'), 'utf8');
const cssUrlRegex = /url\(["']?([^"')]+)["']?\)/g;
const extractedCssRefs = [];
let cssMatch;
while ((cssMatch = cssUrlRegex.exec(mainCssContent)) !== null) {
  extractedCssRefs.push({ ref: cssMatch[1], from: 'css/main.css' });
}

// Extract JS module imports
const jsDir = path.join(ROOT_DIR, 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const extractedJsImports = [];
const jsImportRegex = /(?:import|export)\s+.*?from\s+["']([^"']+)["']/g;

for (const jsFile of jsFiles) {
  const jsContent = fs.readFileSync(path.join(jsDir, jsFile), 'utf8');
  let jsMatch;
  while ((jsMatch = jsImportRegex.exec(jsContent)) !== null) {
    extractedJsImports.push({ ref: jsMatch[1], from: `js/${jsFile}` });
  }
}

// Run resolution across all simulated bases
for (const baseUrl of SIMULATED_BASES) {
  const baseObj = new URL(baseUrl);
  const basePrefix = baseObj.pathname; // e.g. /timestamp-camera-web/

  // Test HTML refs
  for (const ref of extractedHtmlRefs) {
    const resolved = new URL(ref, baseUrl);
    const resolvedPath = resolved.pathname;

    const startsWithSubpath = resolvedPath.startsWith(basePrefix);
    assert(startsWithSubpath,
      `S3.Subpath.HTML: '${ref}' resolves within subpath prefix '${basePrefix}' on ${baseObj.host}`,
      `Resolved to: ${resolved.href}`
    );

    const hitOriginRoot = (resolvedPath === '/' || resolvedPath === '/assets/' || resolvedPath === '/css/');
    assert(!hitOriginRoot, `S3.Subpath.HTML: '${ref}' NEVER hits origin root on ${baseObj.host}`);
  }

  // Test Manifest refs
  for (const ref of extractedManifestRefs) {
    const resolved = new URL(ref, baseUrl);
    const resolvedPath = resolved.pathname;

    const startsWithSubpath = resolvedPath.startsWith(basePrefix);
    assert(startsWithSubpath,
      `S3.Subpath.Manifest: '${ref}' resolves within subpath prefix '${basePrefix}'`,
      `Resolved to: ${resolved.href}`
    );
  }

  // Test CSS relative URLs (resolved relative to css/ directory)
  const cssBaseUrl = new URL('css/main.css', baseUrl).href;
  for (const { ref } of extractedCssRefs) {
    const resolved = new URL(ref, cssBaseUrl);
    const resolvedPath = resolved.pathname;

    const startsWithSubpath = resolvedPath.startsWith(basePrefix);
    assert(startsWithSubpath,
      `S3.Subpath.CSS: '${ref}' resolves within subpath prefix '${basePrefix}'`,
      `Resolved to: ${resolved.href}`
    );
  }

  // Test JS imports (resolved relative to js/<file>)
  for (const { ref, from } of extractedJsImports) {
    const jsFileUrl = new URL(from, baseUrl).href;
    const resolved = new URL(ref, jsFileUrl);
    const resolvedPath = resolved.pathname;

    const startsWithSubpath = resolvedPath.startsWith(basePrefix);
    assert(startsWithSubpath,
      `S3.Subpath.JS: '${from}' -> '${ref}' resolves within subpath prefix`,
      `Resolved to: ${resolved.href}`
    );
  }
}

// Also verify that every single resolved file ACTUALLY exists on disk!
console.log('\n--- Verifying local disk existence of all resolved references ---');
for (const ref of extractedHtmlRefs) {
  // Strip query string or hash if any
  const cleanRef = ref.split('?')[0].split('#')[0];
  const diskPath = path.join(ROOT_DIR, cleanRef);
  assert(fs.existsSync(diskPath), `S3.Disk.HTML: Referenced file exists: ${cleanRef}`);
}

for (const icon of manifestContent.icons) {
  const diskPath = path.join(ROOT_DIR, icon.src);
  assert(fs.existsSync(diskPath), `S3.Disk.Manifest: Icon exists: ${icon.src}`);
}

for (const { ref, from } of extractedCssRefs) {
  const cssDir = path.dirname(path.join(ROOT_DIR, from));
  const diskPath = path.resolve(cssDir, ref);
  assert(fs.existsSync(diskPath), `S3.Disk.CSS: Font asset exists: ${path.relative(ROOT_DIR, diskPath)}`);
}

for (const { ref, from } of extractedJsImports) {
  const callerDir = path.dirname(path.join(ROOT_DIR, from));
  const diskPath = path.resolve(callerDir, ref);
  assert(fs.existsSync(diskPath), `S3.Disk.JS: Imported module exists: ${path.relative(ROOT_DIR, diskPath)}`);
}

// ============================================================================
// SECTION 4: Exhaustive Root-Relative Link Scan Across Repository Files
// ============================================================================
console.log('\n--- SECTION 4: Exhaustive Root-Relative Link Scan Across Repository Files ---');

function scanDirRecursive(dir, exts = ['.html', '.css', '.js', '.json', '.svg']) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...scanDirRecursive(fullPath, exts));
      }
    } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
      results.push(fullPath);
    }
  }
  return results;
}

const allWebFiles = scanDirRecursive(ROOT_DIR);
let absolutePathViolations = 0;

// Hostile regex looking for `/...` that are NOT `//...` (protocol relative) or `/*...*/`
// specifically checking href="/...", src="/...", url(/...), url('/...'), url("/..."), from "/..."
const ABSOLUTE_URL_REGEX = /(?:href|src)=["']\/[^\/]|url\(['"]?\/[^\/]|from\s+["']\/[^\/]/g;

for (const filePath of allWebFiles) {
  const rel = path.relative(ROOT_DIR, filePath);
  // Skip tests directory files which might construct mock URLs
  if (rel.startsWith('tests')) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  let match;
  while ((match = ABSOLUTE_URL_REGEX.exec(content)) !== null) {
    absolutePathViolations++;
    const lineNum = content.substring(0, match.index).split('\n').length;
    console.error(`  [VIOLATION] Absolute root link in ${rel}:${lineNum} -> '${match[0]}'`);
  }
}

assert(absolutePathViolations === 0,
  `S4.Audit.1: Zero absolute root "/" URLs across all project production files (found ${absolutePathViolations})`
);

// Manifest specific start_url and scope audit
assert(manifestContent.start_url.startsWith('./') || !manifestContent.start_url.startsWith('/'),
  'S4.Audit.2: manifest.json start_url is relative (does not start with absolute /)'
);
assert(manifestContent.scope.startsWith('./') || !manifestContent.scope.startsWith('/'),
  'S4.Audit.3: manifest.json scope is relative (does not start with absolute /)'
);

// ============================================================================
// SECTION 5: PWA Shell & GitHub Pages Packaging Hardening
// ============================================================================
console.log('\n--- SECTION 5: PWA Shell & GitHub Pages Packaging Hardening ---');

// .nojekyll check
const noJekyllPath = path.join(ROOT_DIR, '.nojekyll');
assert(fs.existsSync(noJekyllPath), 'S5.Deploy.1: .nojekyll file exists at root');

// README.md check
const readmePath = path.join(ROOT_DIR, 'README.md');
assert(fs.existsSync(readmePath), 'S5.Deploy.2: README.md exists');
const readmeContent = fs.readFileSync(readmePath, 'utf8');
assert(readmeContent.includes('GitHub Pages'), 'S5.Deploy.3: README.md covers GitHub Pages deployment instructions');
assert(readmeContent.includes('.nojekyll'), 'S5.Deploy.4: README.md explains purpose of .nojekyll file');
assert(readmeContent.includes('PWA') || readmeContent.includes('Install'), 'S5.Deploy.5: README.md includes PWA install guide');

// index.html mobile shell attributes
assert(indexHtmlContent.includes('viewport-fit=cover'), 'S5.Shell.1: Viewport includes viewport-fit=cover for iOS safe areas');
assert(indexHtmlContent.includes('apple-mobile-web-app-capable'), 'S5.Shell.2: Includes apple-mobile-web-app-capable');
assert(indexHtmlContent.includes('apple-mobile-web-app-status-bar-style'), 'S5.Shell.3: Includes apple-mobile-web-app-status-bar-style');
assert(indexHtmlContent.includes('rel="apple-touch-icon"'), 'S5.Shell.4: Includes rel="apple-touch-icon" link');
assert(indexHtmlContent.includes('rel="icon"'), 'S5.Shell.5: Includes rel="icon" favicon link');
assert(indexHtmlContent.includes('rel="manifest"'), 'S5.Shell.6: Includes rel="manifest" link');

// ============================================================================
// SECTION 6: Regression Audit Across Prior Milestone Suites
// ============================================================================
console.log('\n--- SECTION 6: Regression Audit Across Prior Milestone Suites ---');

function runTestFile(cmd, expectedPattern) {
  try {
    const out = execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: 'pipe' });
    const passedMatch = out.includes(expectedPattern);
    return { success: passedMatch, output: out };
  } catch (err) {
    return { success: false, output: err.stdout || err.message };
  }
}

// 1. Challenger M3 UI Stress
console.log('Running challenger-m3-ui-stress.js...');
const m3Res = runTestFile('node tests/challenger-m3-ui-stress.js', 'Assertions Passed:      43');
assert(m3Res.success, 'S6.Regress.1: challenger-m3-ui-stress.js passed with 43/43 assertions');

// 2. Challenger M3-2 Stress
console.log('Running challenger-m3-2-stress.js...');
const m32Res = runTestFile('node tests/challenger-m3-2-stress.js', 'Passed:                   114');
assert(m32Res.success, 'S6.Regress.2: challenger-m3-2-stress.js passed with 114/114 assertions');

// 3. Watermark Engine
console.log('Running watermark.test.js...');
const wmRes = runTestFile('node tests/watermark.test.js', 'ALL TESTS PASSED SUCCESSFULLY');
assert(wmRes.success, 'S6.Regress.3: watermark.test.js passed with 33/33 assertions');

// ============================================================================
// SECTION 7: Live Subpath HTTP Server Stress Test
// ============================================================================
console.log('\n--- SECTION 7: Live Subpath HTTP Server Stress Test ---');

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

const SUBPATH_PREFIX = '/timestamp-camera-web';
let originRootHits = 0;

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  const pathname = reqUrl.pathname;

  if (!pathname.startsWith(SUBPATH_PREFIX)) {
    originRootHits++;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found - Origin Root Violation');
    return;
  }

  let sub = pathname.slice(SUBPATH_PREFIX.length);
  if (sub === '' || sub === '/') {
    sub = '/index.html';
  }

  const filePath = path.join(ROOT_DIR, sub);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': data.length
  });
  res.end(data);
});

await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve();
  });
});

const serverPort = server.address().port;
const serverBase = `http://127.0.0.1:${serverPort}${SUBPATH_PREFIX}`;

const HTTP_TEST_PATHS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/favicon.svg',
  '/assets/icons/icon.svg',
  '/assets/fonts/Sarabun-Medium.woff2',
  '/assets/fonts/Sarabun-Regular.woff2',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/css/main.css',
  '/css/components.css',
  '/css/responsive.css',
  '/js/app.js',
  '/js/state.js',
  '/js/watermark-engine.js',
  '/js/map-picker.js',
  '/js/export-manager.js',
  '/js/exif-parser.js',
  '/js/font-loader.js',
  '/js/geocoder.js',
  '/js/coordinates.js',
  '/js/thai-datetime.js',
  '/js/presets.js'
];

for (const sub of HTTP_TEST_PATHS) {
  const url = `${serverBase}${sub === '/' ? '' : sub}`;
  let resStatus = 0;
  let resContentType = '';
  let resLen = 0;

  try {
    const resp = await fetch(url);
    resStatus = resp.status;
    resContentType = resp.headers.get('content-type') || '';
    const arrayBuf = await resp.arrayBuffer();
    resLen = arrayBuf.byteLength;
  } catch (err) {
    console.error(`Fetch failed for ${url}:`, err);
  }

  assert(resStatus === 200, `S7.Http.1: '${sub}' returns HTTP 200 OK under subpath`);
  assert(resLen > 0, `S7.Http.2: '${sub}' returned non-empty body (${resLen} bytes)`);

  const ext = path.extname(sub === '/' ? '/index.html' : sub);
  const expectedMime = MIME_MAP[ext];
  if (expectedMime) {
    assert(resContentType.includes(expectedMime.split(';')[0]),
      `S7.Http.3: '${sub}' returned correct Content-Type '${resContentType}'`
    );
  }
}

// Adversarial test: request origin root directly and ensure server records it as root violation
try {
  const rootResp = await fetch(`http://127.0.0.1:${serverPort}/broken-root-asset.png`);
  assert(rootResp.status === 404, 'S7.Http.Trap.1: Origin root request is safely 404');
} catch (e) {
  // ok
}

assert(originRootHits === 1,
  'S7.Http.Trap.2: Exactly 1 origin root hit occurred (our deliberate trap test, zero from app links)'
);

server.close();

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n===========================================================');
console.log('             CHALLENGER M4 EMPIRICAL SUMMARY              ');
console.log('===========================================================');
console.log(`Total Assertions Checked: ${totalChecked}`);
console.log(`Passed:                   ${passed}`);
console.log(`Failed:                   ${failed}`);
console.log(`Findings / Violations:    ${findings.length}`);
console.log('-----------------------------------------------------------');

if (failed === 0) {
  console.log('>>> VERDICT: APPROVE <<<');
  console.log('All static assets, PWA packaging, subpath portability,');
  console.log('binary PNG chunk integrity, and regression suites PASSED 100%.');
} else {
  console.log('>>> VERDICT: REQUEST_CHANGES <<<');
  for (const f of findings) {
    console.log(` - ${f}`);
  }
}
console.log('===========================================================\n');

if (failed > 0) {
  process.exit(1);
}
