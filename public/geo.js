// ══ Geometry helpers for map-drawn roofs — pure functions, shared with tests ══
//
// Two azimuth conventions meet here:
//   compass bearing : 0° = north, 90° = east, 180° = south, 270° = west (maps, users)
//   model azimuth   : 0° = south, −90° = east, +90° = west, ±180° = north (solar maths)

const R_EARTH = 6371008.8; // mean Earth radius, m
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

export const bearingToAzimuth = b => normalise180(b - 180);
export const azimuthToBearing = az => ((az + 180) % 360 + 360) % 360;
export function normalise180(a) { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassName(bearing) { return POINTS[Math.round(((bearing % 360) + 360) % 360 / 22.5) % 16]; }
export function azimuthLabel(az) { const b = azimuthToBearing(az); return `${compassName(b)} · ${Math.round(b)}°`; }

// Project lat/lng points to a local east/north plane in metres (accurate for building-sized shapes)
export function toLocalXY(pts) {
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
  const kx = R_EARTH * Math.cos(rad(lat0)) * Math.PI / 180, ky = R_EARTH * Math.PI / 180;
  return pts.map(p => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
}

export function polygonArea(pts) {
  if (pts.length < 3) return 0;
  const xy = toLocalXY(pts);
  let a = 0;
  for (let i = 0; i < xy.length; i++) { const p = xy[i], q = xy[(i + 1) % xy.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

// Compass bearing from local-plane vector
const vecBearing = (dx, dy) => (deg(Math.atan2(dx, dy)) + 360) % 360;

// Roof outline analysis. For a pitched roof face the panels face perpendicular to the
// longest edge (ridge/eave line); of the two perpendicular directions we suggest the
// more sun-facing one (closest to south in the northern hemisphere) and offer the other.
export function roofGeometry(pts, lat = 33) {
  if (pts.length < 3) return null;
  const xy = toLocalXY(pts);
  const edges = xy.map((p, i) => {
    const q = xy[(i + 1) % xy.length], dx = q.x - p.x, dy = q.y - p.y;
    return { length: Math.hypot(dx, dy), bearing: vecBearing(dx, dy) };
  });
  const longest = edges.reduce((a, b) => (b.length > a.length ? b : a));
  const perp = [normalise180(longest.bearing + 90 - 180), normalise180(longest.bearing - 90 - 180)]; // as model azimuths
  const sunward = lat >= 0 ? a => Math.abs(a) : a => 180 - Math.abs(a);
  perp.sort((a, b) => sunward(a) - sunward(b));
  return {
    area: polygonArea(pts),
    perimeter: edges.reduce((a, e) => a + e.length, 0),
    edges, longest,
    facing: perp[0],      // suggested panel azimuth (model convention)
    altFacing: perp[1],   // the opposite roof face
  };
}

// ── Drawn roof ↔ URL state ("lat,lng;lat,lng;…") and roof → model inputs ─────
const MAX_ROOF_PTS = 60;

export function formatRoof(pts) {
  return pts.map(p => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`).join(';'); // 7 dp ≈ 1 cm
}

// Returns an array of {lat,lng} (≥ 3 points) or null for anything malformed.
export function parseRoof(str) {
  if (typeof str !== 'string' || !str || str.length > MAX_ROOF_PTS * 30) return null;
  if (!/^[0-9.,;-]+$/.test(str)) return null;
  const pts = str.split(';').slice(0, MAX_ROOF_PTS + 1).map(s => s.split(',').map(Number));
  if (pts.length < 3 || pts.length > MAX_ROOF_PTS) return null;
  if (!pts.every(p => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) return null;
  return pts.map(([lat, lng]) => ({ lat, lng }));
}

// The roof area and panel azimuth the model should use for a drawn roof.
//   flat    → area = plan area, racks face the equator
//   pitched → area = plan area ÷ cos(tilt), panels face perpendicular to the ridge (or the other side)
export function roofApplied(pts, { roofType = 'flat', roofFlip = 0, pitch = 0, lat = 33 } = {}) {
  const geom = roofGeometry(pts, lat);
  if (!geom) return null;
  if (roofType === 'pitched') {
    return { geom, area: geom.area / Math.cos(pitch * Math.PI / 180), orient: Math.round(roofFlip ? geom.altFacing : geom.facing) };
  }
  return { geom, area: geom.area, orient: lat >= 0 ? 0 : 180 };
}

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h)) / 1000; // km
}

export function nearestCity(lat, lon, cities) {
  let best = null;
  for (const c of cities) { const d = haversine({ lat, lon }, c); if (!best || d < best.km) best = { city: c, km: d }; }
  return best;
}

// ── NASA POWER climatology (CORS-enabled, no key) ─────────────────────────────
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const powerUrl = (lat, lon) =>
  `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;

// Validates a POWER response; returns {ghi, tamb} or throws (POWER uses −999 for missing data).
export function parsePower(json) {
  const p = json?.properties?.parameter;
  const ghi = MONTHS.map(m => Number(p?.ALLSKY_SFC_SW_DWN?.[m]));
  const tamb = MONTHS.map(m => Number(p?.T2M?.[m]));
  if (!ghi.every(v => Number.isFinite(v) && v > 0 && v < 12)) throw new Error('Invalid irradiation data');
  if (!tamb.every(v => Number.isFinite(v) && v > -60 && v < 60)) throw new Error('Invalid temperature data');
  return { ghi: ghi.map(v => +v.toFixed(2)), tamb: tamb.map(v => +v.toFixed(1)) };
}
