import {
  C, MN, MDAYS, DEFAULTS, LIMITS, ENUMS, WEATHER, SHIFTS, BUILDINGS, PRESETS, CITIES, DEFAULT_CLIMATE,
  runModel, yearDaily, systemSize, loadProfile, encodeState, decodeState, monthlyCsv, clamp,
} from './model.js';
import { azimuthLabel, nearestCity, haversine, powerUrl, parsePower, parseRoof, roofApplied } from './geo.js';
import { createMapPanel } from './map.js';

const $ = id => document.getElementById(id);
const fmt = (n, dec = 0) => (n == null || !Number.isFinite(n) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
// Adaptive precision so small systems (e.g. 1.4 kWp on a 10 m² roof) don't round to "1"
const sig = n => fmt(n, Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 1 : 2);
const money = n => (Math.abs(n) >= 1e6 ? '$' + fmt(n / 1e6, 2) + 'M' : '$' + fmt(n, Math.abs(n) < 100 && n !== 0 ? 2 : 0));
const yrs = n => (!Number.isFinite(n) || n > 30 ? '30+' : fmt(n, 1));
const fmtDate = doy => new Date(2025, 0, doy).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

// ══ CONTROLS SPEC ═══════════════════════════════════════════════════════════
const CONTROLS = [
  { sect: 'Building & location' },
  { key: 'building', label: 'Building type', options: Object.entries(BUILDINGS).map(([v, label]) => ({ v, label })) },
  { custom: 'location' },
  { sect: 'Selected day' },
  { key: 'doy', label: 'Date', date: true, fmt: v => `day ${v} of 365` },
  { key: 'wx', label: 'Weather (selected day only)', options: Object.entries(WEATHER).map(([v, w]) => ({ v, label: w.label })) },
  { sect: 'Roof & panels' },
  { key: 'area', label: 'Total roof area', num: 'm²', log: true, roofLink: true },
  { key: 'orient', label: 'Panels face', fmt: v => azimuthLabel(v), hint: 'Compass direction the panels face. South is best in Iraq.' },
  { key: 'pitch', label: 'Panel tilt', fmt: v => v + '°' },
  { key: 'eff', label: 'Panel efficiency', fmt: v => v.toFixed(1) + '%' },
  { key: 'cov', label: 'Panel coverage', fmt: v => v + '%', hint: 'Share of the roof covered by panels. Flat roofs with tilted racks: 30–50%' },
  { key: 'soiling', label: 'Dust / soiling loss', fmt: v => v + '%', hint: 'Iraq: 3–8% with regular cleaning, 15%+ without' },
  { key: 'temp', label: 'Extra derating', fmt: v => (v === 0 ? 'None' : v + '%'), hint: 'On top of the modelled temperature loss' },
  { sect: 'Electricity use', only: 'house' },
  { key: 'houseKwh', label: 'Average household use', num: 'kWh/day', only: 'house', hint: 'Annual average; summer is higher, spring lower' },
  { sect: 'Factory load', only: 'factory' },
  { key: 'load', label: 'Load during operating hours', num: 'kW', log: true, only: 'factory' },
  { key: 'shift', label: 'Operating hours', options: Object.entries(SHIFTS).map(([v, s]) => ({ v, label: s.label })), only: 'factory' },
  { key: 'workDays', label: 'Operating days per week', fmt: v => v + ' days', hint: 'Closed days run at 15% base load', only: 'factory' },
  { sect: 'Energy prices' },
  { key: 'price', label: 'Grid electricity price', fmt: v => '$' + v.toFixed(2) + '/kWh' },
  { key: 'dieselShare', label: 'Load on diesel generator', fmt: v => v + '%', hint: 'Share of consumption supplied by generators during grid outages' },
  { key: 'dieselCost', label: 'Diesel generation cost', fmt: v => '$' + v.toFixed(2) + '/kWh' },
  { key: 'exportTariff', label: 'Export credit', fmt: v => '$' + v.toFixed(2) + '/kWh' },
  { key: 'install', label: 'PV install cost', fmt: v => '$' + v + '/kWp' },
  { sect: 'Battery storage' },
  { key: 'batt', label: 'Battery capacity', num: 'kWh' },
  { key: 'battCost', label: 'Battery cost', fmt: v => '$' + v + '/kWh' },
  { key: 'beff', label: 'Round-trip efficiency', fmt: v => v + '%' },
  { sect: 'Grants & finance' },
  { key: 'dutyOn', label: 'Import duty exemption (15% on hardware)', check: true },
  { key: 'euOn', label: 'EU co-finance (20%, max $300k) — unconfirmed', check: true },
  { key: 'grant', label: 'Custom grant / subsidy', fmt: v => v + '%' },
  { key: 'loan', label: 'Soft-loan interest rate', fmt: v => v.toFixed(1) + '%' },
];

let S = { ...DEFAULTS };
let CLIM = DEFAULT_CLIMATE;

const LOCATION_HTML = `<div class="fld">
  <div class="fl"><label for="in-city">Location</label><span class="fv" id="v-latlon"></span></div>
  <select id="in-city">${CITIES.map((c, i) => `<option value="${i}">${c.name}</option>`).join('')}<option value="custom">Custom (picked on map)</option></select>
  <button class="btn btn-block" type="button" id="btn-to-map">📍 Pick on map / draw roof</button>
</div>`;

function buildControls() {
  const root = $('controls-body');
  root.innerHTML = CONTROLS.map(c => {
    const only = c.only ? ` data-only="${c.only}"` : '';
    if (c.custom === 'location') return LOCATION_HTML;
    if (c.sect) return `<div class="sect"${only}>${c.sect}</div>`;
    const id = 'in-' + c.key;
    if (c.check) return `<div class="fld"><label class="chk"><input type="checkbox" id="${id}" data-key="${c.key}"> ${c.label}</label></div>`;
    const [lo, hi] = LIMITS[c.key] || [];
    const value = c.num
      ? `<span class="fv"><input type="number" class="num" id="num-${c.key}" data-key="${c.key}" min="${lo}" max="${hi}" step="any" inputmode="decimal" aria-label="${c.label} (${c.num})"> ${c.num}</span>`
      : c.fmt ? `<span class="fv" id="v-${c.key}"></span>` : '';
    const head = `<div class="fl"><label for="${id}">${c.label}</label>${value}</div>`;
    let input;
    if (c.date) input = DATE_HTML;
    else if (c.options) input = `<select id="${id}" data-key="${c.key}">${c.options.map(o => `<option value="${o.v}">${o.label}</option>`).join('')}</select>`;
    else if (c.log) input = `<input type="range" id="${id}" data-key="${c.key}" data-log="1" min="0" max="${LOG_STEPS}" step="1" aria-label="${c.label} (logarithmic scale)">`;
    else input = `<input type="range" id="${id}" data-key="${c.key}" min="${lo}" max="${hi}" step="${LIMITS[c.key][2]}">`;
    const link = c.roofLink ? '<div class="roof-link" id="roof-link" hidden></div>' : '';
    return `<div class="fld"${only}>${head}${input}${link}${c.hint ? `<div class="hint">${c.hint}</div>` : ''}</div>`;
  }).join('');
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-doy-step],[data-doy]');
    if (b) setDoy(b.dataset.doy === 'today' ? todayDoy() : b.dataset.doy ? +b.dataset.doy : S.doy + +b.dataset.doyStep);
    if (e.target.closest('#roof-link [data-act="apply"]')) applyRoof(true);
    if (e.target.closest('#roof-link [data-act="map"]')) goToMap();
  });
  $('in-city').addEventListener('change', e => {
    if (e.target.value === 'custom') return goToMap();
    const c = CITIES[+e.target.value];
    setLocation(c.lat, c.lon, 'preset');
    mapPanel.setView(c.lat, c.lon, 14);
  });
  $('btn-to-map').addEventListener('click', goToMap);
}

function goToMap() {
  setSheet(false);
  switchTab('location');
  $('tab-location').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Date picker (any year maps onto a 365-day model year; 29 Feb → 28 Feb) ──
const MODEL_YEAR = 2026; // a non-leap year, so the calendar has exactly 365 days
const doyToIso = doy => new Date(Date.UTC(MODEL_YEAR, 0, doy)).toISOString().slice(0, 10);
function isoToDoy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const mo = clamp(+m[2], 1, 12), d = clamp(+m[3], 1, MDAYS[mo - 1]);
  return MDAYS.slice(0, mo - 1).reduce((a, b) => a + b, 0) + d;
}
const todayDoy = () => { const t = new Date(); return isoToDoy(`2026-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`); };
const DATE_HTML = `<div class="date-row">
  <button class="btn" type="button" data-doy-step="-1" aria-label="Previous day">‹</button>
  <input type="date" id="in-doy" data-key="doy" min="${MODEL_YEAR}-01-01" max="${MODEL_YEAR}-12-31" required>
  <button class="btn" type="button" data-doy-step="1" aria-label="Next day">›</button>
</div>
<div class="date-chips" aria-label="Quick dates">
  <button class="btn" type="button" data-doy="today">Today</button>
  <button class="btn" type="button" data-doy="80" title="Spring equinox">21 Mar</button>
  <button class="btn" type="button" data-doy="172" title="Summer solstice: longest day">21 Jun</button>
  <button class="btn" type="button" data-doy="266" title="Autumn equinox">23 Sep</button>
  <button class="btn" type="button" data-doy="355" title="Winter solstice: shortest day">21 Dec</button>
</div>`;
function setDoy(doy) {
  S.doy = ((Math.round(doy) - 1 + 365) % 365) + 1; // wraps 31 Dec ↔ 1 Jan
  syncControls();
  scheduleRender();
}

// ── Log-scale sliders (roof area, load) so a 100 m² house and a 50,000 m² factory are both easy to set
const LOG_STEPS = 1000;
const toPos = (k, v) => { const [lo, hi] = LIMITS[k]; return Math.round(LOG_STEPS * Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo)); };
function fromPos(k, pos) {
  const [lo, hi] = LIMITS[k], v = lo * (hi / lo) ** (pos / LOG_STEPS);
  const r = v < 20 ? Math.round(v * 2) / 2 : v < 1000 ? Math.round(v) : v < 10000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100;
  return clamp(r, lo, hi);
}

function onInput(e) {
  const el = e.target, k = el.dataset.key;
  if (!k) return;
  let v;
  if (el.type === 'checkbox') v = el.checked ? 1 : 0;
  else if (k in ENUMS) v = el.value;
  else if (el.type === 'date') { v = isoToDoy(el.value); if (v == null) { if (e.type === 'change') syncControls(); return; } }
  else if (el.dataset.log) v = fromPos(k, +el.value);
  else {
    v = parseFloat(el.value);
    if (!Number.isFinite(v)) { if (e.type === 'change') syncControls(); return; } // empty box: restore on blur
    const [lo, hi] = LIMITS[k];
    if (el.type === 'number' && e.type === 'input' && (v < lo || v > hi)) return; // wait for blur to clamp
    v = clamp(v, lo, hi);
  }
  if (S[k] === v && e.type === 'change' && el.type !== 'number') return;
  const wasLinked = roofLinked();
  S[k] = v;
  if (k === 'building') {
    // Presets never overwrite a roof the user has drawn on the map
    const keep = S.roof ? ['area', 'orient', ...(S.roofType === 'pitched' ? ['pitch'] : [])] : [];
    for (const [pk, pv] of Object.entries(PRESETS[v])) if (!keep.includes(pk)) S[pk] = pv;
    toast(v === 'house'
      ? `House defaults applied${S.roof ? ' — keeping your drawn roof' : ': 150 m² roof'}, 30 kWh/day, 10 kWh battery`
      : `Factory defaults applied${S.roof ? ' — keeping your drawn roof' : ': 5,000 m² roof'}, 800 kW load`);
  }
  // Tilt changes the sloped area of a pitched roof: keep a linked roof in step
  if (wasLinked && (k === 'pitch' || k === 'building')) applyRoof(false);
  // Don't rewrite the number box the user is typing in; do clamp it once they leave it
  syncControls(el.type === 'number' && e.type === 'input' ? el : null);
  scheduleRender();
}

function syncControls(skip = null) {
  for (const c of CONTROLS) {
    if (!c.key) continue;
    const el = $('in-' + c.key);
    if (c.check) el.checked = !!S[c.key];
    else if (c.date) { if (el !== skip) el.value = doyToIso(S.doy); }
    else if (c.log) { if (el !== skip) el.value = toPos(c.key, S[c.key]); }
    else if (el !== skip) el.value = S[c.key];
    const num = c.num && $('num-' + c.key);
    if (num && num !== skip) num.value = +(+S[c.key]).toFixed(1);
  }
  syncRoofLink();
  // Show only the inputs relevant to the building type
  document.querySelectorAll('#controls-body [data-only]').forEach(el => { el.hidden = el.dataset.only !== S.building; });
  const ci = CITIES.findIndex(c => haversine({ lat: S.lat, lon: S.lon }, c) < 1);
  $('in-city').value = ci >= 0 ? String(ci) : 'custom';
  syncLabels();
}
function syncLabels() {
  for (const c of CONTROLS) if (c.fmt) $('v-' + c.key).textContent = c.fmt(S[c.key]);
  $('v-latlon').textContent = `${S.lat.toFixed(3)}°, ${S.lon.toFixed(3)}°`;
}

// ══ LOCATION & CLIMATE ══════════════════════════════════════════════════════
// Built-in city within 3 km → its NASA POWER data. Otherwise fetch NASA POWER live for the
// exact point (cached per browser); until it arrives — or if offline — use the nearest city.
const climCacheKey = (lat, lon) => `clim:${lat.toFixed(2)},${lon.toFixed(2)}`;
let climRequest = 0;

async function resolveClimate(lat, lon) {
  const near = nearestCity(lat, lon, CITIES);
  if (near.km < 3) { CLIM = { ...near.city, source: 'NASA POWER (built-in)' }; return; }
  if (CLIM.live && haversine({ lat, lon }, CLIM) < 5) return; // POWER grid is ~50 km; no need to refetch
  try {
    const cached = JSON.parse(localStorage.getItem(climCacheKey(lat, lon)) || 'null');
    if (cached) { CLIM = cached; return; }
  } catch { /* storage unavailable */ }
  CLIM = { ...near.city, name: `Near ${near.city.name}`, lat, lon,
    source: `approx. — ${near.city.name} data (${fmt(near.km, 0)} km away), fetching NASA POWER…` };
  const req = ++climRequest;
  $('loc-status').textContent = 'Fetching climate data…';
  try {
    const res = await fetch(powerUrl(lat, lon));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = parsePower(await res.json());
    if (req !== climRequest) return;                      // a newer location was picked meanwhile
    CLIM = { name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, lat, lon, ...data, source: 'NASA POWER (live)', live: true };
    try { localStorage.setItem(climCacheKey(lat, lon), JSON.stringify(CLIM)); } catch { /* ignore */ }
    $('loc-status').textContent = '';
  } catch {
    if (req !== climRequest) return;
    CLIM = { ...CLIM, source: `approx. — using ${near.city.name} data (${fmt(near.km, 0)} km away); NASA POWER unavailable` };
    $('loc-status').textContent = 'Using nearest-city climate';
  }
}

async function setLocation(lat, lon, how) {
  S.lat = +clamp(lat, ...LIMITS.lat).toFixed(5);
  S.lon = +clamp(lon, ...LIMITS.lon).toFixed(5);
  syncControls();
  const pending = resolveClimate(S.lat, S.lon);
  scheduleRender();            // immediate update with the provisional climate
  await pending;
  scheduleRender();
  if (how === 'map' || how === 'search' || how === 'gps') toast(`Location set: ${CLIM.name}`);
}

// ══ DRAWN ROOF → MODEL ══════════════════════════════════════════════════════
// The roof outline lives in S.roof (and the URL). While "linked", the model's roof area
// and panel orientation are taken from it; editing either by hand unlinks it until the
// user presses "Use drawn roof" again.
function roofDerived() {
  const pts = parseRoof(S.roof);
  if (!pts) return null;
  const a = roofApplied(pts, S);
  return { ...a, area: Math.round(clamp(a.area, ...LIMITS.area) * 10) / 10 };
}
function roofLinked() {
  const d = roofDerived();
  return !!d && Math.abs(d.area - S.area) < 0.06 && d.orient === S.orient;
}
function applyRoof(announce) {
  const d = roofDerived();
  if (!d) return;
  S.area = d.area;
  S.orient = d.orient;
  syncControls();
  scheduleRender();
  flash('num-area');
  if (announce) toast(`Roof applied: ${fmt(S.area, S.area < 100 ? 1 : 0)} m², panels face ${azimuthLabel(S.orient)}${S.roofType === 'flat' ? ' (racks)' : ''}`);
}
// A link that carries a roof but no explicit area/orientation takes them from the roof
function stateFromHash() {
  S = decodeState(location.hash);
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const d = roofDerived();
  if (d && !p.has('area')) S.area = d.area;
  if (d && !p.has('orient')) S.orient = d.orient;
}

function onRoofChange({ roof, announce }) {
  S.roof = roof;
  if (roof) applyRoof(announce);
  else { syncControls(); scheduleRender(); }
}
function syncRoofLink() {
  const box = $('roof-link'), d = roofDerived();
  box.hidden = !d;
  if (!d) return;
  const linked = roofLinked();
  box.classList.toggle('manual', !linked);
  box.innerHTML = linked
    ? `📐 From your roof drawing (${S.roofType}, faces ${azimuthLabel(d.orient)}) · <button type="button" data-act="map">edit on map</button>`
    : `✏️ Changed by hand. Your drawn roof is ${fmt(d.area, d.area < 100 ? 1 : 0)} m² facing ${azimuthLabel(d.orient)}. <button type="button" data-act="apply">Use drawn roof</button>`;
}
function flash(id) {
  const el = $(id);
  el?.classList.remove('flash'); void el?.offsetWidth; el?.classList.add('flash');
}

const mapPanel = createMapPanel({ getState: () => S, onPick: setLocation, onRoofChange, toast: (...a) => toast(...a) });

// Roof-card controls (flat/pitched, flip side, re-apply)
document.querySelectorAll('input[name="rooftype"]').forEach(r => r.addEventListener('change', () => {
  S.roofType = r.value; S.roofFlip = 0; applyRoof(true);
}));
$('btn-flip').addEventListener('click', () => { S.roofFlip = S.roofFlip ? 0 : 1; applyRoof(true); });
$('btn-apply-roof').addEventListener('click', () => applyRoof(true));

// ══ CHARTS ══════════════════════════════════════════════════════════════════
const CHARTS = {};
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COL = { sun: '#d48a00', sunA: 'rgba(212,138,0,0.7)', green: '#4caf73', greenD: '#2a7d4f', blue: '#3b89e0', blueD: '#1a5ca8', red: '#e05050', redD: '#b83030', grey: '#888' };

function scales(yl, extra = {}) {
  const ax = { grid: { color: 'rgba(128,128,128,0.12)' }, ticks: { font: { size: 10 }, color: COL.grey, maxRotation: 0, autoSkipPadding: 6 } };
  return { x: { ...ax, ...extra.x }, y: { ...ax, title: { display: !!yl, text: yl, font: { size: 10 }, color: COL.grey }, ...extra.y } };
}
const legend = show => ({ display: show, labels: { font: { size: 10 }, boxWidth: 10, padding: 8, color: COL.grey } });
const base = (yl, opts = {}) => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: legend(!!opts.legend), tooltip: opts.tooltip || {} },
  scales: scales(yl, opts.scales),
  ...opts.extra,
});
function mk(id, cfg) { CHARTS[id]?.destroy(); CHARTS[id] = new Chart($(id), cfg); }

function initCharts() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const hrs = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');
  mk('c1', { type: 'bar', data: { labels: hrs, datasets: [
    { type: 'line', label: 'Load', data: [], borderColor: COL.redD, borderWidth: 1.5, pointRadius: 0, stepped: 'middle', order: 0 },
    { label: 'Solar kWh', data: [], backgroundColor: COL.sunA, borderRadius: 2, order: 1 }] },
    options: base('kWh', { legend: true, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)} kWh` } } }) });
  mk('c2', { type: 'bar', data: { labels: MN, datasets: [{ label: 'kWh', data: [], backgroundColor: COL.sunA, borderRadius: 2 }] },
    options: base('MWh', { tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y, 1)} MWh` } } }) });
  const stack = { x: { stacked: true }, y: { stacked: true } };
  mk('cb1', { type: 'bar', data: { labels: hrs, datasets: [
    { label: 'Solar → load', data: [], backgroundColor: 'rgba(76,175,115,0.85)' },
    { label: 'Battery → load', data: [], backgroundColor: 'rgba(42,125,79,0.9)' },
    { label: 'Grid import', data: [], backgroundColor: 'rgba(224,80,80,0.55)' },
    { label: 'Solar → battery', data: [], backgroundColor: 'rgba(212,138,0,0.75)' },
    { label: 'Solar → export', data: [], backgroundColor: 'rgba(59,137,224,0.75)' }] },
    options: base('kWh', { legend: true, scales: stack, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)} kWh` } } }) });
  mk('cb2', { type: 'line', data: { labels: MN, datasets: [
    { label: 'Self-consumption %', data: [], borderColor: COL.green, backgroundColor: 'rgba(76,175,115,0.1)', tension: 0.3, fill: true, pointRadius: 3 },
    { label: 'Solar fraction %', data: [], borderColor: COL.sun, tension: 0.3, pointRadius: 3 }] },
    options: base('%', { legend: true, scales: { y: { min: 0, max: 100 } } }) });
  mk('cb3', { type: 'line', data: { labels: hrs, datasets: [{ label: 'State of charge kWh', data: [], borderColor: COL.sun, backgroundColor: 'rgba(212,138,0,0.15)', tension: 0.3, fill: true, pointRadius: 0 }] },
    options: base('kWh', { scales: { y: { min: 0 } } }) });
  mk('co1', { type: 'line', data: { labels: [], datasets: [{ label: 't CO₂/yr', data: [], borderColor: COL.greenD, backgroundColor: 'rgba(42,125,79,0.1)', tension: 0.3, fill: true, pointRadius: 2 }] }, options: base('t CO₂/yr') });
  mk('co2c', { type: 'line', data: { labels: [], datasets: [{ label: '$/yr', data: [], borderColor: COL.sun, backgroundColor: 'rgba(212,138,0,0.1)', tension: 0.3, fill: true, pointRadius: 2 }] },
    options: base('$ / yr', { tooltip: { callbacks: { label: c => ' ' + money(c.parsed.y) } } }) });
  mk('co3', { type: 'line', data: { labels: [], datasets: [{ label: 'Payback yrs', data: [], borderColor: COL.blueD, tension: 0.3, pointRadius: [], pointBackgroundColor: [] }] }, options: base('Years') });
  mk('co4', { type: 'line', data: { labels: [], datasets: [{ label: 'MWh/yr', data: [], borderColor: COL.sun, backgroundColor: 'rgba(212,138,0,0.15)', tension: 0.3, fill: true, pointRadius: [], pointBackgroundColor: COL.redD }] }, options: base('MWh/yr') });
  mk('co5', { type: 'radar', data: { labels: [], datasets: [{ label: '% of best', data: [], backgroundColor: 'rgba(212,138,0,0.2)', borderColor: COL.sun, pointBackgroundColor: COL.sun, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: legend(false) },
      scales: { r: { min: 0, max: 100, ticks: { font: { size: 9 }, color: COL.grey, stepSize: 20, backdropColor: 'transparent' }, grid: { color: 'rgba(128,128,128,0.2)' }, angleLines: { color: 'rgba(128,128,128,0.2)' }, pointLabels: { color: COL.grey, font: { size: 11 } } } } } });
  mk('co6', { type: 'line', data: { labels: MN, datasets: [
    { label: 'With heat losses', data: [], borderColor: COL.redD, backgroundColor: 'rgba(184,48,48,0.12)', tension: 0.3, fill: true, pointRadius: 0 },
    { label: 'Without heat losses', data: [], borderColor: 'rgba(212,138,0,0.6)', borderDash: [5, 4], tension: 0.3, pointRadius: 0 }] },
    options: base('MWh', { legend: true }) });
  mk('lcoe', { type: 'bar', data: { labels: ['Solar (this system)', 'Solar + battery', 'Solar w/ grants', 'Iraq grid', 'Diesel backup'],
    datasets: [{ data: [], backgroundColor: [COL.green, COL.greenD, COL.blueD, COL.redD, '#8b0000'], borderRadius: 3 }] },
    options: base('', { extra: { indexAxis: 'y' }, tooltip: { callbacks: { label: c => ` $${c.parsed.x.toFixed(3)}/kWh` } } }) });
  mk('npv', { type: 'line', data: { labels: Array.from({ length: C.LIFE_YRS + 1 }, (_, i) => 'Yr ' + i), datasets: [
    { label: 'Low price ($0.07)', data: [], borderColor: COL.redD, tension: 0.3, pointRadius: 0 },
    { label: 'Current price', data: [], borderColor: COL.sun, borderWidth: 2.5, tension: 0.3, pointRadius: 0 },
    { label: 'High price ($0.20)', data: [], borderColor: COL.greenD, tension: 0.3, pointRadius: 0 }] },
    options: base('NPV $', { legend: true, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }) });
  const ax2 = scales('°C').y;
  mk('cl1', { type: 'bar', data: { labels: MN, datasets: [
    { label: 'Irradiation kWh/m²/day', data: [], backgroundColor: COL.sunA, borderRadius: 2, yAxisID: 'y' },
    { type: 'line', label: 'Air temperature °C', data: [], borderColor: COL.redD, tension: 0.3, pointRadius: 2, yAxisID: 'y2' }] },
    options: base('kWh/m²/day', { legend: true, scales: { y: { min: 0 } },
      extra: {} }) });
  CHARTS.cl1.options.scales.y2 = { ...ax2, position: 'right', grid: { drawOnChartArea: false } };
}

// Location tab + header: what place and climate data the model is using
function renderLocation(r) {
  const cl = r.climate;
  const where = cl.live || cl.source.startsWith('approx') ? `${S.lat.toFixed(3)}°N, ${S.lon.toFixed(3)}°E` : cl.name;
  text('subtitle', `${where} · ${BUILDINGS[S.building]} · climate: ${cl.source} · USD`);
  text('clim-src', cl.source);
  text('cl-ghi', fmt(r.annual.ghiYear));
  text('cl-tmax', fmt(Math.max(...cl.tamb), 1));
  text('cl-latlon', `${S.lat.toFixed(3)}, ${S.lon.toFixed(3)}`);
  $('gmaps').href = mapPanel.googleUrl(S.lat, S.lon);
  setData('cl1', cl.ghi, cl.tamb);
  mapPanel.renderCard(S, roofLinked());
}

function setData(id, ...arrays) {
  const ch = CHARTS[id];
  arrays.forEach((a, i) => { ch.data.datasets[i].data = a; });
  ch.update('none');
}

// ══ RENDER ══════════════════════════════════════════════════════════════════
let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

const text = (id, v) => { $(id).textContent = v; };
const metric = (k, v) => { document.querySelector(`[data-m="${k}"]`).textContent = v; };
let last;

function render() {
  const r = runModel(S, CLIM);
  last = r;
  const { annual: a, economics: e, day } = r;
  history.replaceState(null, '', location.pathname + location.search + (encodeState(S) ? '#' + encodeState(S) : ''));

  const mwh = a.genKwh / 1000;
  text('annualbadge', `Annual: ${sig(mwh)} MWh`);
  metric('daily', sig(day.total));
  metric('peak', sig(day.peak));
  metric('kwp', sig(r.size.kWp));
  metric('annual', sig(mwh));
  metric('savings', e.saving < 100 ? fmt(e.saving, 2) : fmt(e.saving));
  metric('co2', sig(a.co2t));
  metric('panels', fmt(r.size.panelCount));
  metric('sf', fmt(a.solarFraction, 1));
  metric('export', sig(a.exportKwh / 1000));
  metric('payback', yrs(e.paybackAfter));
  $('sheet-summary').innerHTML = `<b>${sig(mwh)}</b> MWh/yr · <b>${money(e.saving)}</b>/yr · payback <b>${yrs(e.paybackAfter)}</b> yrs`;

  // Generation
  text('dlbl', `${fmtDate(S.doy)} · ${WEATHER[S.wx].label} · operating day`);
  text('ytot', `Total ${sig(mwh)} MWh/yr · ${fmt(a.specificYield)} kWh/kWp`);
  const r2 = arr => arr.map(v => +v.toFixed(2));
  setData('c1', r2(loadProfile(S, true, r.month)), r2(day.hourly));
  renderLocation(r);
  setData('c2', r.monthly.map(m => +(m.genKwh / 1000).toFixed(3)));
  renderHeatmap();
  renderRoof();

  // Battery
  const sim = day.sim;
  text('battdate', fmtDate(S.doy) + ' · operating day');
  text('bv1', sig(sim.totals.gen - sim.totals.export));
  text('bv2', sig(sim.totals.export));
  text('bv3', fmt(a.battCycles, 0));
  const r1 = r2;
  setData('cb1', r1(sim.direct), r1(sim.discharge), r1(sim.import), r1(sim.charge), r1(sim.export));
  setData('cb2', r.monthly.map(m => +m.selfConsumption.toFixed(1)), r.monthly.map(m => +m.solarFraction.toFixed(1)));
  setData('cb3', r1(sim.soc));
  text('bve1', money(e.battExtraSaving));
  text('bve2', money(e.battCapex));
  text('bve3', S.batt === 0 ? '—' : yrs(e.battPayback));
  const surplusPct = a.genKwh > 0 ? a.exportKwh / a.genKwh * 100 : 0;
  text('batt-note', S.batt === 0
    ? `No battery selected. ${fmt(surplusPct, 0)}% of solar output is currently exported${surplusPct > 10 ? ' — try adding a battery to store it.' : ', so a battery would add little value.'}`
    : e.battExtraSaving < e.battCapex * C.OM_RATE
      ? 'Solar output rarely exceeds the building load at these settings, so there is little surplus to store. Increase roof area/coverage or reduce load to see battery value.'
      : `Battery value comes from shifting surplus solar (otherwise exported at $${S.exportTariff.toFixed(2)}) to cover load worth $${r.effPrice.toFixed(2)}/kWh. Max charge/discharge 0.5C.`);

  // Optimisation
  const cov = r.sweeps.cov, best = r.sweeps.bestCov;
  const covLbl = cov.map(c => c.cov + '%');
  const p4 = v => +v.toPrecision(4); // chart values readable for both 10 m² and 30,000 m² roofs
  CHARTS.co1.data.labels = covLbl; setData('co1', cov.map(c => p4(c.co2t)));
  CHARTS.co2c.data.labels = covLbl; setData('co2c', cov.map(c => p4(c.saving)));
  const ds3 = CHARTS.co3.data.datasets[0];
  CHARTS.co3.data.labels = covLbl;
  ds3.pointRadius = cov.map(c => (c.cov === best ? 6 : c.cov === S.cov ? 4 : 2));
  ds3.pointBackgroundColor = cov.map(c => (c.cov === best ? COL.green : c.cov === S.cov ? COL.redD : COL.blueD));
  setData('co3', cov.map(c => (Number.isFinite(c.payback) ? +c.payback.toFixed(2) : null)));
  text('sweet', `Shortest payback at ${best}% coverage (green) · current ${S.cov}% (red)`);
  const tilt = r.sweeps.tilt, bestT = tilt.reduce((x, y) => (y.mwh > x.mwh ? y : x));
  CHARTS.co4.data.labels = tilt.map(t => t.tilt + '°');
  CHARTS.co4.data.datasets[0].pointRadius = tilt.map(t => (Math.abs(t.tilt - S.pitch) < 1.25 ? 6 : 0));
  setData('co4', tilt.map(t => p4(t.mwh)));
  text('tiltbest', `Best ≈ ${bestT.tilt}° (${sig(bestT.mwh)} MWh)`);
  CHARTS.co5.data.labels = r.sweeps.orient.map(o => o.label);
  setData('co5', r.sweeps.orient.map(o => +o.pct.toFixed(1)));
  const withT = r.monthly.map(m => m.genKwh / 1000), noT = r.noTempMonthly.map(v => v / 1000);
  const lost = 1 - withT.reduce((x, y) => x + y) / noT.reduce((x, y) => x + y);
  setData('co6', withT.map(p4), noT.map(p4));
  text('templost', `${fmt(lost * 100, 1)}% of annual output lost to heat`);

  // Financing
  const g = e.grants;
  text('g1val', S.dutyOn ? money(g.duty) + ' saved' : 'not applied');
  text('g4val', S.euOn ? money(g.eu) : 'not applied');
  text('g5val', money(g.custom));
  text('gtotal', money(g.total));
  text('g2val', 'up to ' + money(e.wbEligible));
  text('g3val', '~' + money(e.ifcCover) + ' cover');
  text('pb_before', yrs(e.paybackBefore) + ' yrs');
  text('pb_after', yrs(e.paybackAfter) + ' yrs');
  text('fs1', money(e.capex));
  text('fs2', money(g.total));
  text('fs3', money(e.netCapex));
  text('fs4', money(e.loanPayment));
  text('fs5', money(e.cashflow));
  $('fs5').className = 'v ' + (e.cashflow >= 0 ? 'c-green' : 'c-red');
  text('fs6', money(e.npv25));
  setData('lcoe', [r.lcoe.solar, r.lcoe.solarBatt, r.lcoe.solarGrants, r.lcoe.grid, r.lcoe.diesel].map(v => +v.toFixed(4)));
  const npvDs = CHARTS.npv.data.datasets, ep = r.effPrice;
  npvDs[0].label = `Price −30% ($${(ep * 0.7).toFixed(3)})`;
  npvDs[1].label = `Current ($${ep.toFixed(3)}/kWh${S.dieselShare ? ' blended' : ''})`;
  npvDs[2].label = `Price +50% ($${(ep * 1.5).toFixed(3)})`;
  setData('npv', r.npv.low.map(p4), r.npv.mid.map(p4), r.npv.high.map(p4));

  document.body.dataset.ready = '1';
}

// ── Heat map (months × days) — only recomputed when inputs that affect it change
let hmKey = '';
const HM_STOPS = ['#f5c842', '#e8a020', '#c97010', '#8b4500'];
function lerpHex(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
function hmColor(n) {
  const s = [css('--hm0').startsWith('#') ? css('--hm0') : '#ece9e1', ...HM_STOPS];
  const x = Math.min(0.9999, Math.max(0, n)) * (s.length - 1), i = Math.floor(x);
  return lerpHex(s[i], s[i + 1], x - i);
}
function renderHeatmap() {
  const key = ['pitch', 'orient', 'eff', 'area', 'cov', 'soiling', 'temp', 'lat'].map(k => S[k]).join('|') + CLIM.ghi.join();
  if (key === hmKey) return;
  hmKey = key;
  const daily = yearDaily(S, CLIM);
  const lo = Math.min(...daily), hi = Math.max(...daily);
  let html = '<span></span>' + Array.from({ length: 31 }, (_, d) => `<span style="text-align:center">${(d + 1) % 5 === 0 || d === 0 ? d + 1 : ''}</span>`).join('');
  let doy = 0;
  MDAYS.forEach((n, m) => {
    html += `<span>${MN[m]}</span>`;
    for (let d = 0; d < 31; d++) {
      if (d < n) {
        const v = daily[doy++];
        html += `<div class="cell" style="background:${hmColor((v - lo) / Math.max(1, hi - lo))}" title="${MN[m]} ${d + 1}: ~${fmt(v)} kWh"></div>`;
      } else html += '<span></span>';
    }
  });
  $('heatmap').innerHTML = html;
  text('hm-range', `${fmt(lo)} – ${fmt(hi)} kWh/day · long-term average weather`);
  document.querySelector('.hm-scale').style.background = `linear-gradient(90deg, ${[0, .25, .5, .75, 1].map(hmColor).join(',')})`;
}

function renderRoof() {
  const { area, cov, orient, pitch } = S;
  const rw = 380, rh = 148, rx = 18, ry = 11, pw = 16, ph = 9, gap = 2.5;
  const { panelArea, panelCount } = systemSize(S);
  const cols = Math.floor((rw - 12) / (pw + gap)), rows = Math.floor((rh - 20) / (ph + gap));
  // Large roofs: each cell is a block of panels. Small roofs: draw the actual panel slots.
  const slots = Math.floor(area / C.PANEL_M2);
  const total = Math.min(cols * rows, slots);
  const filled = slots <= cols * rows ? panelCount : Math.round(total * cov / 100);
  const cx = rx + rw + 80, cy = ry + rh / 2, cR = 30;
  // Screen: north = up, east = right. Azimuth convention: 0 = south, +west.
  const a = (90 + orient) * Math.PI / 180;   // 0 → pointing down (south)
  const ax = cx - Math.sin(a - Math.PI / 2) * cR * 0.8, ay = cy + Math.cos(a - Math.PI / 2) * cR * 0.8;
  const dx = ax - cx, dy = ay - cy;
  let out = `<defs><marker id="aro" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="#e85020" stroke-width="1.5" stroke-linecap="round"/></marker></defs>`;
  out += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="4" fill="#c8d8b0" stroke="#90b068"/>`;
  out += `<text x="${rx + 8}" y="${ry + 12}" font-size="9" fill="#3a5a20" font-weight="700">ROOF ${fmt(area)} m²</text>`;
  for (let n = 0; n < total; n++) {
    const c = n % cols, rr = Math.floor(n / cols), on = n < filled;
    out += `<rect x="${rx + 7 + c * (pw + gap)}" y="${ry + 17 + rr * (ph + gap)}" width="${pw}" height="${ph}" rx="1" fill="${on ? '#1a5ca8' : '#c8d8b0'}" stroke="${on ? '#0d3a7a' : '#90b068'}" stroke-width="0.5" opacity="${on ? 0.9 : 0.35}"/>`;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="${cR + 6}" fill="var(--bg3)" stroke="var(--border2)" stroke-width="0.5"/>`;
  [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]].forEach(([l, x, y]) => {
    out += `<text x="${cx + x * (cR + 16)}" y="${cy + y * (cR + 16)}" font-size="10" text-anchor="middle" dominant-baseline="central" fill="var(--text2)" font-weight="600">${l}</text>`;
  });
  out += `<line x1="${cx - dx * 0.5}" y1="${cy - dy * 0.5}" x2="${ax}" y2="${ay}" stroke="#e85020" stroke-width="2.2" stroke-linecap="round" marker-end="url(#aro)"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="2.5" fill="#e85020"/>`;
  out += `<text x="${cx}" y="${ry + rh + 6}" font-size="9" text-anchor="middle" fill="var(--text3)">panels face</text>`;
  $('rsvg').innerHTML = out;
  text('roofstats', `${roofLinked() ? '📐 from your map drawing · ' : ''}${fmt(panelArea, panelArea < 100 ? 1 : 0)} m² covered · ${fmt(panelCount)} panels · tilt ${pitch}°${slots > cols * rows ? ' · not to scale' : ''}`);
}

// ══ TABS ════════════════════════════════════════════════════════════════════
const tabs = [...document.querySelectorAll('.tab')];
function switchTab(name, focus = false) {
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
    if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  document.querySelectorAll('.panel').forEach(p => {
    const on = p.id === 'tab-' + name;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
  // Charts (and the map) in hidden panels have zero size until shown
  Object.values(CHARTS).forEach(c => c.canvas.closest('.panel.active') && c.resize());
  if (name === 'location' && typeof L !== 'undefined') mapPanel.show();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
  t.addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) switchTab(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true);
  });
});

// ══ MOBILE INPUT SHEET ══════════════════════════════════════════════════════
function setSheet(open) {
  $('controls').classList.toggle('open', open);
  $('backdrop').hidden = !open;
  $('btn-open-controls').setAttribute('aria-expanded', open);
  $('btn-open-controls').hidden = open;
}
$('btn-open-controls').addEventListener('click', () => setSheet(true));
$('btn-close-controls').addEventListener('click', () => setSheet(false));
$('backdrop').addEventListener('click', () => setSheet(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setSheet(false); });

// ══ ACTIONS ═════════════════════════════════════════════════════════════════
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
$('btn-share').addEventListener('click', async () => {
  try {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: document.title, url: location.href });
    else { await navigator.clipboard.writeText(location.href); toast('Scenario link copied'); }
  } catch { toast('Copy the address bar to share this scenario'); }
});
$('btn-csv').addEventListener('click', () => {
  const blob = new Blob([monthlyCsv(last)], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'iraq-solar-model.csv' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('btn-print').addEventListener('click', () => window.print());
$('btn-reset').addEventListener('click', () => {
  S = { ...DEFAULTS }; CLIM = DEFAULT_CLIMATE;
  syncControls(); render(); mapPanel.setView(S.lat, S.lon, 14); mapPanel.loadRoof();
  toast('Inputs reset to defaults');
});
window.addEventListener('hashchange', async () => {
  stateFromHash(); syncControls();
  await resolveClimate(S.lat, S.lon); render(); mapPanel.setView(S.lat, S.lon); mapPanel.loadRoof(true);
});
window.addEventListener('beforeprint', () => Object.values(CHARTS).forEach(c => c.resize()));

// ══ METHOD TEXT ═════════════════════════════════════════════════════════════
$('method-losses').innerHTML = [
  `Temperature: hourly cell temperature from NOCT ${C.NOCT}°C, coefficient ${C.TEMP_COEFF * 100}%/°C, ambient monthly mean ±${C.DIURNAL_SWING}°C daily swing`,
  `Balance of system (inverter, wiring, mismatch, availability): ${Math.round((1 - C.BOS_EFF) * 100)}%`,
  'Dust / soiling and extra derating: set in the inputs',
  `Panel degradation: ${C.DEGRADATION * 100}%/yr (economics only)`,
].map(s => `<li>${s}</li>`).join('');
$('method-eco').innerHTML = [
  'Savings = (load no longer bought) × blended price + exported kWh × export credit. The blended price mixes the grid price and diesel generation cost by the share of load on the generator',
  'Only whole panels are counted (1.75 m² each), so small roofs are sized realistically',
  `O&M ${C.OM_RATE * 100}% of capex per year; ${C.LIFE_YRS}-year life; ${C.DISC_RATE * 100}% discount rate for NPV and LCOE`,
  `Grants (each can be switched on/off): import-duty saving (${C.DUTY_RATE * 100}% on the ${C.HW_SHARE * 100}% hardware share of PV cost, on by default), EU co-finance (${C.EU_SHARE * 100}%, max $${fmt(C.EU_CAP)}, off by default as it is not guaranteed), custom %`,
  'NPV price sensitivity: −30% and +50% around the current blended electricity price',
  `Loan: annuity over ${C.LOAN_YRS} years on the net cost after grants, at the soft-loan rate`,
  `CO₂ factor ${C.CO2_KG_PER_KWH} kg/kWh (Iraq grid)`,
].map(s => `<li>${s}</li>`).join('');

// ══ INIT ════════════════════════════════════════════════════════════════════
stateFromHash();
buildControls();
syncControls();
if (typeof Chart === 'undefined') {
  document.body.insertAdjacentHTML('afterbegin', '<p class="note warn" style="margin:8px">Charts failed to load. Please refresh.</p>');
} else {
  initCharts();
  const climReady = resolveClimate(S.lat, S.lon); // shared link to a custom spot → fetch its climate
  render();
  climReady.then(() => render());
}
