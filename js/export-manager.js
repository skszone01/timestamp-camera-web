/**
 * export-manager.js
 * 
 * High-Resolution Export Pipeline & Web Share API Manager for Timestamp Camera Web.
 * 
 * Features:
 * 1. Full-Resolution Export:
 *    - Delegates high-fidelity rendering to js/watermark-engine.js (exportFullResolution).
 *    - Preserves 100% original camera sensor resolution (up to 48MP/8192px GPU ceiling).
 * 2. Web Share API Pipeline (Mobile Direct Camera Roll Saving - Single & Multi-Photo Batch):
 *    - Checks navigator.canShare({ files }).
 *    - Packages JPEG Blob(s) into native File object(s).
 *    - Invokes native OS Share Sheet on iOS Safari and Android Chrome, enabling direct
 *      1-tap "Save to Photos" / "Save N Images" to local camera roll without extra dialogs.
 * 3. Desktop Fallback Download:
 *    - Standard dynamic <a> anchor tag trigger with blob URL and automatic memory revocation.
 * 4. Standardized Timestamped Naming:
 *    - Generates ISO-compliant filenames: timestamp_YYYYMMDD_HHmmss.jpg.
 * 5. Asynchronous Progress & Loading Notification:
 *    - Emits progress hooks ('rendering', 'sharing', 'downloading', 'done', 'error')
 *      to toggle UI button spinner states.
 * 
 * Milestone: M3-UI
 */

import { exportFullResolution } from './watermark-engine.js';
import { isValidDate, toValidDate } from './thai-datetime.js';

/**
 * Generates standardized timestamped export filename:
 * Format: "timestamp_YYYYMMDD_HHmmss.jpg"
 * 
 * @param {string} [originalFilename=''] - Source photo name (optional)
 * @param {Date|number|string} [date=new Date()] - Timestamp to encode
 * @returns {string} Standardized filename
 */
export function generateExportFilename(originalFilename = '', date = new Date()) {
  const d = toValidDate(date) || new Date();
  const pad = (n) => String(n).padStart(2, '0');

  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());

  return `timestamp_${yyyy}${mm}${dd}_${hh}${min}${ss}.jpg`;
}

/**
 * Checks whether the Web Share API is available and capable of sharing image files
 * in the current browser runtime environment.
 * 
 * @param {File|File[]} [testFile] - Optional File or array of Files to test
 * @returns {boolean} True if navigator.canShare({ files }) is supported
 */
export function canUseWebShare(testFile = null) {
  if (typeof navigator === 'undefined') {
    return false;
  }
  if (!navigator.share || typeof navigator.canShare !== 'function') {
    return false;
  }

  try {
    if (Array.isArray(testFile)) {
      if (!testFile.length) return false;
      return navigator.canShare({ files: testFile });
    }
    const file = testFile || (typeof File !== 'undefined' ? new File([], 'test.jpg', { type: 'image/jpeg' }) : null);
    if (!file) return false;
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Detects in-app browsers (Facebook, Messenger, Instagram, LINE, ...) that ignore
 * <a download> and blob downloads.
 *
 * @param {string} [ua] - User agent (defaults to navigator.userAgent)
 * @returns {string|null} App name, or null for a regular browser
 */
export function getInAppBrowserName(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  const text = String(ua || '');
  if (/FBAN\/Messenger|MessengerForiOS|Orca-Android/i.test(text)) return 'Messenger';
  if (/FB_IAB|FBAN|FBAV|FBIOS|FB4A/i.test(text)) return 'Facebook';
  if (/Instagram/i.test(text)) return 'Instagram';
  if (/\bLine\//i.test(text)) return 'LINE';
  if (/MicroMessenger/i.test(text)) return 'WeChat';
  if (/TikTok|musical_ly|BytedanceWebview/i.test(text)) return 'TikTok';
  return null;
}

/**
 * @param {string} [ua] - User agent (defaults to navigator.userAgent)
 * @returns {boolean} True on iPhone / iPad (including iPadOS reporting as Mac)
 */
export function isAppleMobile(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
}

/**
 * Triggers standard desktop browser download via dynamically appended <a> element.
 * 
 * @param {Blob} blob - Image blob to download
 * @param {string} filename - Target file name
 * @returns {{ downloaded: boolean, filename: string }}
 */
export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined' || !document.createElement) {
    return { downloaded: true, filename };
  }

  const url = (typeof URL !== 'undefined' && URL.createObjectURL)
    ? URL.createObjectURL(blob)
    : 'blob:' + filename;

  const anchor = document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();

  // Clean up DOM and revoke blob URL after brief delay
  setTimeout(() => {
    if (document.body.contains(anchor)) {
      document.body.removeChild(anchor);
    }
    if (typeof URL !== 'undefined' && URL.revokeObjectURL && typeof url === 'string' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }, 500);

  return { downloaded: true, filename };
}

/**
 * Shares a single image Blob or File via the Web Share API.
 *
 * @param {Blob|File} blob - JPEG Blob or File to share
 * @param {string} [filename] - Target filename
 * @param {string} [title='Timestamp Photo'] - Share sheet title
 * @returns {Promise<{ shared: boolean, filename?: string, cancelled?: boolean, error?: any }>}
 */
export async function shareImage(blob, filename, title = 'Timestamp Photo') {
  const resolvedFilename = filename || (blob && typeof blob.name === 'string' && blob.name ? blob.name : generateExportFilename());

  if (!blob) {
    return { shared: false, error: new Error('Invalid image blob') };
  }

  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return { shared: false, error: new Error('Web Share API is not supported') };
  }

  try {
    const mimeType = (blob && blob.type) || 'image/jpeg';
    const file = (typeof File !== 'undefined')
      ? (blob instanceof File && blob.name === resolvedFilename ? blob : new File([blob], resolvedFilename, { type: mimeType }))
      : blob;

    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      return { shared: false, error: new Error('Web Share API cannot share this file') };
    }

    await navigator.share({
      files: [file],
      title
    });

    return { shared: true, filename: resolvedFilename };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { shared: false, cancelled: true };
    }
    return { shared: false, error };
  }
}

/**
 * Shares multiple images in a single native OS Share Sheet invocation.
 *
 * @param {Array<{ blob?: Blob, file?: File, filename?: string, name?: string }|File|Blob>} items - Images to share
 * @param {string} [title] - Optional share sheet title
 * @returns {Promise<{ shared: boolean, count?: number, cancelled?: boolean, error?: any }>}
 */
export async function shareMultipleImages(items, title) {
  if (!Array.isArray(items) || items.length === 0) {
    return { shared: false, error: new Error('No images provided to share') };
  }

  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return { shared: false, error: new Error('Web Share API is not supported') };
  }

  try {
    const files = items.map((item, idx) => {
      if (typeof File !== 'undefined' && item instanceof File) {
        return item;
      }
      if (item && typeof File !== 'undefined' && item.file instanceof File) {
        return item.file;
      }
      const blob = (item && item.blob !== undefined) ? item.blob : item;
      const itemFilename = (item && (item.filename || item.name))
        ? (item.filename || item.name)
        : generateExportFilename('', new Date(Date.now() + idx * 1000));
      const mimeType = (blob && blob.type) || 'image/jpeg';
      return (typeof File !== 'undefined')
        ? new File([blob], itemFilename, { type: mimeType })
        : blob;
    });

    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files })) {
      return { shared: false, error: new Error('Web Share API cannot share multiple files') };
    }

    const shareTitle = title || `Timestamp Photos (${files.length})`;
    await navigator.share({
      files,
      title: shareTitle
    });

    return { shared: true, count: files.length };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { shared: false, cancelled: true };
    }
    return { shared: false, error };
  }
}

/**
 * Attempts to share one or more generated image Files using the Web Share API.
 * 
 * @param {File|File[]} fileOrFiles - JPEG File object or array of File objects
 * @param {string} [title='Timestamp Photo'] - Share sheet title
 * @returns {Promise<boolean>} True if shared successfully or user dismissed share dialog without error
 */
export async function shareFile(fileOrFiles, title = 'Timestamp Photo') {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return false;
  }

  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  if (!files.length) return false;

  try {
    await navigator.share({
      files,
      title
    });
    return true;
  } catch (err) {
    // If user cancelled the native share sheet, treat as clean completion
    if (err.name === 'AbortError') {
      return true;
    }
    throw err;
  }
}

/**
 * High-Resolution Export Orchestrator:
 * 1. Encodes image + watermark into full-resolution JPEG Blob via exportFullResolution.
 * 2. On supported mobile platforms (iOS/Android), opens native Share Sheet (Web Share API)
 *    allowing instant 1-tap "Save to Photos" / "Save Image".
 * 3. On desktop or unsupported platforms, triggers automatic file download.
 * 
 * @param {HTMLImageElement|ImageBitmap|File|Blob} imageSource - Source image (or pre-rendered Blob if watermarkData is a filename string)
 * @param {object|string} watermarkData - { dateTimeStr, coordsStr, addressStr } or filename string
 * @param {object} [options={}]
 * @param {number} [options.orientation=1] - EXIF orientation tag (1-8)
 * @param {string} [options.filename=''] - Custom filename (defaults to timestamp_YYYYMMDD_HHmmss.jpg)
 * @param {Date} [options.date=new Date()] - Date for filename generation
 * @param {number} [options.quality=0.95] - JPEG quality compression factor (0.92 - 0.95)
 * @param {boolean} [options.forceDownload=false] - Force anchor download even if Web Share is supported
 * @param {Function} [options.onProgress] - Callback (phase: 'rendering'|'sharing'|'downloading'|'done'|'error', detail?: any)
 * @returns {Promise<{ method: 'share'|'download', filename: string, blob: Blob, shared: boolean, downloaded: boolean }>}
 */
export async function exportImage(imageSource, watermarkData, options = {}) {
  const opts = options || {};
  const notify = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  try {
    let blob;
    let filename;

    if (typeof watermarkData === 'string') {
      blob = imageSource;
      filename = watermarkData || opts.filename || generateExportFilename('', opts.date || new Date());
    } else {
      notify('rendering');

      // 1. Render high-resolution canvas offscreen and produce JPEG blob
      blob = await exportFullResolution(imageSource, watermarkData, {
        ...opts,
        orientation: opts.orientation || 1,
        quality: typeof opts.quality === 'number' ? opts.quality : 0.95,
        mimeType: 'image/jpeg'
      });

      // 2. Generate standardized timestamped filename
      filename = opts.filename
        ? opts.filename
        : generateExportFilename('', opts.date || new Date());
    }

    let method = 'download';

    // 3. Attempt Web Share API if supported and not explicitly bypassed
    if (!opts.forceDownload && typeof File !== 'undefined') {
      try {
        const file = new File([blob], filename, { type: 'image/jpeg' });
        if (canUseWebShare(file)) {
          notify('sharing');
          await shareFile(file, 'Timestamp Photo');
          method = 'share';
        } else {
          notify('downloading');
          downloadBlob(blob, filename);
          method = 'download';
        }
      } catch (shareErr) {
        // Fallback to desktop download if share failed
        console.warn('[ExportManager] Web Share failed, falling back to download:', shareErr);
        notify('downloading');
        downloadBlob(blob, filename);
        method = 'download';
      }
    } else {
      notify('downloading');
      downloadBlob(blob, filename);
      method = 'download';
    }

    notify('done', { filename, method });
    return {
      method,
      filename,
      blob,
      shared: method === 'share',
      downloaded: method === 'download'
    };
  } catch (err) {
    notify('error', err);
    throw err;
  }
}

/**
 * Alias for exportImage that exports full-resolution image and delivers via Web Share or download.
 */
export const exportAndDeliver = exportImage;

/**
 * Backward-compatible alias for exportImage matching test suites.
 */
export const shareOrDownload = exportImage;

/**
 * ExportManager static namespace class
 */
export class ExportManager {
  static generateFilename(originalFilename, date) {
    return generateExportFilename(originalFilename, date);
  }
  static canShare(file) {
    return canUseWebShare(file);
  }
  static download(blob, filename) {
    return downloadBlob(blob, filename);
  }
  static shareImage(blob, filename, title) {
    return shareImage(blob, filename, title);
  }
  static shareMultipleImages(items, title) {
    return shareMultipleImages(items, title);
  }
  static export(image, watermarkData, options) {
    return exportImage(image, watermarkData, options);
  }
  static exportAndDeliver(image, watermarkData, options) {
    return exportAndDeliver(image, watermarkData, options);
  }
}
