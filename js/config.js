/**
 * config.js
 *
 * ค่าตั้งค่าที่แก้ได้เองโดยไม่ต้องแตะโค้ดส่วนอื่น
 */

/**
 * Google Geocoding API key (ไม่บังคับ)
 * - เว้นว่าง  → ใช้ OpenStreetMap Nominatim (ฟรี ไม่ต้องมี key)
 * - ใส่ key   → ใช้ Google Geocoding หาอำเภอ/จังหวัด (ต้องเปิด Geocoding API + billing ใน Google Cloud
 *               และควรจำกัด key ให้ใช้ได้เฉพาะโดเมน github.io ของคุณ)
 */
export const GOOGLE_GEOCODING_API_KEY = '';

/**
 * ชั้นแผนที่เริ่มต้น: 'google' | 'google-hybrid' | 'osm'
 */
export const DEFAULT_MAP_LAYER = 'google';
