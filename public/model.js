// ══ Iraq solar model — pure calculation core ═══════════════════════════════
// No DOM access here: this module is shared by the browser app (app.js) and the
// automated test-suite (tests/model.test.mjs).
//
// Conventions (Duffie & Beckman, "Solar Engineering of Thermal Processes"):
//   azimuth 0° = south, negative = east, positive = west, ±180° = north
//   tilt 0° = horizontal; hours are local solar time
//
// Location: the state carries lat/lon (sun geometry); the climate object carries the
// long-term monthly irradiation and temperature for that place (NASA POWER).

import { CITIES } from './locations.js';

export { CITIES };
export const DEFAULT_CLIMATE = Object.freeze({ ...CITIES[0], source: 'NASA POWER (built-in)' }); // Baghdad
export const ALBEDO = 0.25; // dry, light-coloured ground/roofs

export const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const C = {
  GSC: 1367,             // solar constant W/m²
  STEP: 0.25,            // simulation time-step, hours
  NOCT: 45,              // nominal operating cell temperature °C
  TEMP_COEFF: -0.004,    // power temperature coefficient /°C (crystalline Si)
  DIURNAL_SWING: 7,      // ± °C around the monthly mean, peaking 15:00
  BOS_EFF: 0.86,         // inverter, wiring, mismatch, availability
  PANEL_M2: 1.75,        // m² per ~400 W module
  CO2_KG_PER_KWH: 0.60,  // Iraq grid emission factor (fossil-heavy)
  DISC_RATE: 0.08,
  LIFE_YRS: 25,
  DEGRADATION: 0.005,    // per year
  OM_RATE: 0.01,         // O&M per year as share of capex
  HW_SHARE: 0.60,        // hardware share of PV install cost (duty applies to this)
  DUTY_RATE: 0.15,
  EU_SHARE: 0.20, EU_CAP: 300000,
  WB_SHARE: 0.70,        // share of net capex eligible for concessional debt
  IFC_COVER: 0.10,
  LOAN_YRS: 20,
  BATT_C_RATE: 0.5,      // max charge/discharge power = 0.5 × capacity
  NIGHT_LOAD: 0.15,      // factory base load outside shift / on closed days, share of shift load
};

// Factory operating pattern: full load between start and end, base load otherwise.
export const SHIFTS = {
  day: { label: 'Day shift 07:00–19:00', start: 7, end: 19 },
  extended: { label: 'Two shifts 06:00–22:00', start: 6, end: 22 },
  '24h': { label: 'Continuous 24 h', start: 0, end: 24 },
};

// Household load shape (illustrative Iraqi home: daytime cooling, evening peak) and
// seasonal factor (air-conditioning roughly doubles summer use). Both normalised to mean 1.
const norm = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return a.map(v => v / m); };
export const HOUSE_HOURLY = norm([0.70, 0.65, 0.60, 0.60, 0.60, 0.70, 0.85, 0.90, 0.85, 0.80, 0.85, 0.95,
  1.05, 1.15, 1.20, 1.20, 1.25, 1.35, 1.50, 1.55, 1.50, 1.35, 1.10, 0.85]);
export const HOUSE_SEASON = norm([1.05, 0.95, 0.80, 0.80, 1.00, 1.30, 1.45, 1.45, 1.20, 0.90, 0.85, 1.00]);

export const BUILDINGS = { factory: 'Factory / commercial', house: 'House / residential' };

// Values applied when the user switches building type (everything else is kept).
export const PRESETS = {
  factory: { area: 5000, cov: 70, pitch: 15, load: 800, shift: 'day', workDays: 6, batt: 0, dieselShare: 0 },
  house: { area: 150, cov: 35, pitch: 25, houseKwh: 30, batt: 10, dieselShare: 40, dieselCost: 0.30 },
};

// Daily clearness index used for the "selected day" view. 'average' = long-term monthly mean.
export const WEATHER = {
  average: { label: 'Long-term average', kt: null },
  clear: { label: 'Clear sky', kt: 0.74 },
  partly: { label: 'Partly cloudy', kt: 0.55 },
  dusty: { label: 'Dust haze / sandstorm', kt: 0.40 },
  overcast: { label: 'Overcast', kt: 0.25 },
};

export const DEFAULTS = Object.freeze({
  building: 'factory', lat: DEFAULT_CLIMATE.lat, lon: DEFAULT_CLIMATE.lon,
  doy: 172, wx: 'average', pitch: 15, eff: 20, area: 5000, cov: 70, orient: 0, soiling: 5, temp: 0,
  price: 0.10, dieselShare: 0, dieselCost: 0.28, exportTariff: 0.05, install: 950,
  load: 800, shift: 'day', workDays: 6, houseKwh: 30, batt: 0, battCost: 350, beff: 90,
  dutyOn: 1, euOn: 0, grant: 0, loan: 5,
});

// Text-valued inputs and their allowed values
export const ENUMS = { wx: Object.keys(WEATHER), shift: Object.keys(SHIFTS), building: Object.keys(BUILDINGS) };

// Numeric limits [min, max, step] — used by the UI sliders and to sanitise shared URLs.
export const LIMITS = {
  lat: [-60, 70, 0.0001], lon: [-180, 180, 0.0001],
  doy: [1, 365, 1], pitch: [0, 45, 1], eff: [15, 23, 0.5], area: [10, 100000, 10], cov: [20, 90, 5],
  orient: [-180, 180, 1], soiling: [0, 20, 1], temp: [0, 20, 1], price: [0.03, 0.35, 0.01],
  dieselShare: [0, 100, 5], dieselCost: [0.15, 0.50, 0.01], exportTariff: [0, 0.15, 0.01], install: [500, 1800, 50],
  load: [1, 5000, 1], workDays: [5, 7, 1], houseKwh: [2, 300, 1], batt: [0, 5000, 5], battCost: [150, 800, 10],
  beff: [80, 97, 1], dutyOn: [0, 1, 1], euOn: [0, 1, 1], grant: [0, 60, 5], loan: [0, 15, 0.5],
};

// ── helpers ────────────────────────────────────────────────────────────────
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = a => a.reduce((x, y) => x + y, 0);
const climOf = s => s.clim || DEFAULT_CLIMATE;
const latOf = s => s.lat ?? DEFAULTS.lat;

export function midDoy(m) { let d = 0; for (let i = 0; i < m; i++) d += MDAYS[i]; return d + Math.ceil(MDAYS[m] / 2); }
export function doyToMonth(doy) { let c = 0; for (let i = 0; i < 12; i++) { c += MDAYS[i]; if (doy <= c) return i; } return 11; }

// ── solar geometry ─────────────────────────────────────────────────────────
export function declination(doy) { return 23.45 * Math.sin(rad(360 * (284 + doy) / 365)); }

export function sunPosition(doy, hour, lat = DEFAULTS.lat) {
  const phi = rad(lat), d = rad(declination(doy)), w = rad(15 * (hour - 12));
  const cz = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(w);
  const zen = Math.acos(clamp(cz, -1, 1));
  let az = 0;
  if (Math.sin(zen) > 1e-6) {
    const ca = (cz * Math.sin(phi) - Math.sin(d)) / (Math.sin(zen) * Math.cos(phi));
    az = Math.sign(w) * deg(Math.acos(clamp(ca, -1, 1)));
    if (w === 0 && lat < declination(doy)) az = 180; // noon sun north of zenith (tropics/southern hemisphere)
  }
  return { cosZenith: cz, elevation: 90 - deg(zen), azimuth: az };
}

export function cosIncidence(pos, tilt, surfAz) {
  const b = rad(tilt), sinZ = Math.sqrt(Math.max(0, 1 - pos.cosZenith ** 2));
  return pos.cosZenith * Math.cos(b) + sinZ * Math.sin(b) * Math.cos(rad(pos.azimuth - surfAz));
}

export function sunriseSunset(doy, lat = DEFAULTS.lat) {
  const c = -Math.tan(rad(lat)) * Math.tan(rad(declination(doy)));
  if (c >= 1) return { rise: 12, set: 12 };
  if (c <= -1) return { rise: 0, set: 24 };
  const H = deg(Math.acos(c)) / 15;
  return { rise: 12 - H, set: 12 + H };
}

export function extraterrestrialH(doy, hour, lat = DEFAULTS.lat) {
  const cz = sunPosition(doy, hour, lat).cosZenith;
  return cz > 0 ? C.GSC * (1 + 0.033 * Math.cos(rad(360 * doy / 365))) * cz : 0;
}

// Erbs et al. diffuse fraction from clearness index
export function diffuseFraction(kt) {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.80) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

// Isotropic-sky (Liu–Jordan) transposition of horizontal irradiance onto the panel plane
export function poaIrradiance(ghi, pos, kt, tilt, surfAz, albedo = ALBEDO) {
  if (ghi <= 0 || pos.cosZenith <= 0) return 0;
  const dhi = ghi * diffuseFraction(kt), bhi = ghi - dhi;
  const rb = Math.max(0, cosIncidence(pos, tilt, surfAz)) / Math.max(pos.cosZenith, 0.087);
  const cb = Math.cos(rad(tilt));
  return bhi * rb + dhi * (1 + cb) / 2 + ghi * albedo * (1 - cb) / 2;
}

const STEPS = Math.round(24 / C.STEP);
const ktCache = new Map();
// Monthly clearness index so that the modelled mid-month day reproduces the climate's GHI
export function monthlyKt(m, s = DEFAULTS) {
  const clim = climOf(s), lat = latOf(s);
  const key = `${lat}|${m}|${clim.ghi[m]}`;
  if (ktCache.has(key)) return ktCache.get(key);
  const doy = midDoy(m);
  let h0 = 0;
  for (let i = 0; i < STEPS; i++) h0 += extraterrestrialH(doy, (i + 0.5) * C.STEP, lat) * C.STEP;
  const kt = h0 > 0 ? clamp(clim.ghi[m] * 1000 / h0, 0.05, 0.85) : 0;
  if (ktCache.size > 5000) ktCache.clear();
  ktCache.set(key, kt);
  return kt;
}

// ── system ─────────────────────────────────────────────────────────────────
// Only whole panels can be installed — matters for small roofs (a 10 m² roof at 70% fits 4 panels).
export function systemSize(s) {
  const panelCount = Math.floor(s.area * s.cov / 100 / C.PANEL_M2 + 1e-9);
  const panelArea = panelCount * C.PANEL_M2;
  return { panelArea, kWp: panelArea * s.eff / 100, panelCount };
}

// PV output for one day at C.STEP resolution. Returns hourly kWh (24 values) and stats.
export function dayGeneration(doy, kt, s, opts = {}) {
  const { kWp } = systemSize(s);
  const m = doyToMonth(doy), lat = latOf(s), tmean = climOf(s).tamb[m];
  const tilt = opts.tilt ?? s.pitch, az = opts.orient ?? s.orient;
  const loss = (1 - s.soiling / 100) * (1 - s.temp / 100) * C.BOS_EFF;
  const hourly = new Array(24).fill(0);
  let ghiSum = 0, poaSum = 0;
  for (let i = 0; i < STEPS; i++) {
    const t = (i + 0.5) * C.STEP;
    const pos = sunPosition(doy, t, lat);
    if (pos.cosZenith <= 0) continue;
    const ghi = kt * extraterrestrialH(doy, t, lat);
    const poa = poaIrradiance(ghi, pos, kt, tilt, az);
    const tamb = tmean + C.DIURNAL_SWING * Math.cos(2 * Math.PI * (t - 15) / 24);
    const tcell = tamb + (C.NOCT - 20) / 800 * poa;
    const tf = opts.noTemp ? 1 : Math.max(0, 1 + C.TEMP_COEFF * (tcell - 25));
    hourly[Math.floor(t)] += kWp * poa / 1000 * tf * loss * C.STEP;
    ghiSum += ghi * C.STEP; poaSum += poa * C.STEP;
  }
  return { hourly, total: sum(hourly), peak: Math.max(...hourly), ghi: ghiSum / 1000, poa: poaSum / 1000 };
}

// Hourly demand (kW) for one day. Factory: shift pattern; house: daily kWh × shape × season.
export function loadProfile(s, working = true, month = 5) {
  if (s.building === 'house') {
    const daily = s.houseKwh * HOUSE_SEASON[month];
    return HOUSE_HOURLY.map(f => daily / 24 * f);
  }
  const { start, end } = SHIFTS[s.shift];
  return Array.from({ length: 24 }, (_, h) => (working && h >= start && h < end ? s.load : s.load * C.NIGHT_LOAD));
}

// Value of a kWh of displaced on-site supply: blend of grid and diesel generator
export const effectivePrice = (s, gridPrice = s.price) =>
  gridPrice * (1 - s.dieselShare / 100) + s.dieselCost * s.dieselShare / 100;

// Hourly battery dispatch: solar → load first, surplus → battery, remainder → export.
// The day is simulated twice so the start-of-day state of charge is in steady state.
export function simulateDay(gen, demand, cap, rte) {
  const ef = Math.sqrt(rte / 100), pmax = cap * C.BATT_C_RATE;
  let soc = cap * 0.5, out;
  for (let pass = 0; pass < 2; pass++) {
    out = { direct: [], charge: [], discharge: [], export: [], import: [], soc: [] };
    for (let h = 0; h < 24; h++) {
      const g = gen[h], d = demand[h];
      const direct = Math.min(g, d);
      const surplus = g - direct, deficit = d - direct;
      const charge = Math.min(surplus, pmax, (cap - soc) / ef);       // PV energy into battery
      soc += charge * ef;
      const discharge = Math.min(deficit, pmax, soc * ef);            // energy delivered to load
      soc -= discharge / ef;
      out.direct.push(direct); out.charge.push(charge); out.discharge.push(discharge);
      out.export.push(surplus - charge); out.import.push(deficit - discharge); out.soc.push(soc);
    }
  }
  const t = k => sum(out[k]);
  out.totals = {
    gen: sum(gen), load: sum(demand), direct: t('direct'), charge: t('charge'),
    discharge: t('discharge'), export: t('export'), import: t('import'),
  };
  return out;
}

// Energy-only annual run (12 representative mean days) — used by the main model and the sweeps.
// Factories: working and closed days (base load only) are simulated separately, weighted by workDays/7.
export function annualEnergy(s, batt = s.batt) {
  const f = s.building === 'house' ? 1 : s.workDays / 7;
  const months = MDAYS.map((days, m) => {
    const g = dayGeneration(midDoy(m), monthlyKt(m, s), s);
    const a = simulateDay(g.hourly, loadProfile(s, true, m), batt, s.beff).totals;
    const b = f < 1 ? simulateDay(g.hourly, loadProfile(s, false, m), batt, s.beff).totals : a;
    const mix = {};
    for (const k of Object.keys(a)) mix[k] = a[k] * f + b[k] * (1 - f);
    return { days, ...mix, gen: g.total, cycles: batt > 0 ? mix.discharge / batt : 0 };
  });
  const yr = k => sum(months.map(x => x[k] * x.days));
  return {
    months,
    gen: yr('gen'), load: yr('load'), avoided: yr('load') - yr('import'),
    export: yr('export'), import: yr('import'), cycles: yr('cycles'),
  };
}

export const valueOf = (e, price, tariff) => e.avoided * price + e.export * tariff;

export function grantsFor(capex, pvCapex, s) {
  const duty = s.dutyOn ? pvCapex * C.HW_SHARE * C.DUTY_RATE : 0;
  const eu = s.euOn ? Math.min(capex * C.EU_SHARE, C.EU_CAP) : 0;
  const custom = capex * s.grant / 100;
  const total = Math.min(capex, duty + eu + custom);
  return { duty, eu, custom, total };
}

const annuity = (amt, rate, yrs) => (rate > 0 ? amt * rate / (1 - (1 + rate) ** -yrs) : amt / yrs);
const payback = (cost, net) => (net > 0 ? cost / net : Infinity);

function npvSeries(netCapex, y1Saving, om) {
  const out = [-netCapex];
  for (let y = 1; y <= C.LIFE_YRS; y++) {
    const cf = y1Saving * (1 - C.DEGRADATION) ** (y - 1) - om;
    out.push(out[y - 1] + cf / (1 + C.DISC_RATE) ** y);
  }
  return out;
}

function discountedEnergy(annualKwh) {
  let e = 0;
  for (let y = 1; y <= C.LIFE_YRS; y++) e += annualKwh * (1 - C.DEGRADATION) ** (y - 1) / (1 + C.DISC_RATE) ** y;
  return e;
}
const pvFactor = () => { let f = 0; for (let y = 1; y <= C.LIFE_YRS; y++) f += 1 / (1 + C.DISC_RATE) ** y; return f; };

function economicsFor(s, e) {
  const { kWp } = systemSize(s);
  const pvCapex = kWp * s.install, battCapex = s.batt * s.battCost, capex = pvCapex + battCapex;
  const g = grantsFor(capex, pvCapex, s);
  const netCapex = capex - g.total;
  const om = capex * C.OM_RATE;
  const saving = valueOf(e, effectivePrice(s), s.exportTariff);
  return { pvCapex, battCapex, capex, grants: g, netCapex, om, saving, net: saving - om,
    paybackBefore: payback(capex, saving - om), paybackAfter: payback(netCapex, saving - om) };
}

// ── full model ─────────────────────────────────────────────────────────────
export function runModel(input, clim = DEFAULT_CLIMATE) {
  const s = { ...sanitizeState(input), clim };
  const size = systemSize(s);
  const month = doyToMonth(s.doy);
  const demand = loadProfile(s, true, month);
  const effPrice = effectivePrice(s);

  // Selected day (a working day for factories)
  const kt = WEATHER[s.wx].kt ?? monthlyKt(month, s);
  const day = dayGeneration(s.doy, kt, s);
  const daySim = simulateDay(day.hourly, demand, s.batt, s.beff);

  // Year
  const e = annualEnergy(s);
  const e0 = s.batt > 0 ? annualEnergy(s, 0) : e;
  const eco = economicsFor(s, e);
  const ecoNoBatt = economicsFor({ ...s, batt: 0 }, e0);
  const battExtraSaving = eco.saving - ecoNoBatt.saving;

  const monthly = e.months.map((x, m) => ({
    month: MN[m], days: x.days, genKwh: x.gen * x.days, loadKwh: x.load * x.days,
    selfConsumption: x.gen > 0 ? (x.gen - x.export) / x.gen * 100 : 0,
    solarFraction: x.load > 0 ? (x.load - x.import) / x.load * 100 : 0,
    exportKwh: x.export * x.days, importKwh: x.import * x.days,
  }));
  const noTempMonthly = MDAYS.map((days, m) => dayGeneration(midDoy(m), monthlyKt(m, s), s, { noTemp: true }).total * days);

  // Finance
  const loanPayment = annuity(eco.netCapex, s.loan / 100, C.LOAN_YRS);
  // Price sensitivity relative to the current (blended) electricity value
  const npv = {
    low: npvSeries(eco.netCapex, valueOf(e, effPrice * 0.7, s.exportTariff), eco.om),
    mid: npvSeries(eco.netCapex, eco.saving, eco.om),
    high: npvSeries(eco.netCapex, valueOf(e, effPrice * 1.5, s.exportTariff), eco.om),
  };
  const dE = discountedEnergy(e.gen), pf = pvFactor();
  const pvGrants = grantsFor(eco.pvCapex, eco.pvCapex, s).total;
  const lcoe = dE > 0 ? {
    solar: (eco.pvCapex * (1 + C.OM_RATE * pf)) / dE,
    solarBatt: (eco.capex * (1 + C.OM_RATE * pf)) / dE,
    grid: s.price,
    diesel: s.dieselCost,
    solarGrants: (eco.pvCapex - pvGrants + eco.pvCapex * C.OM_RATE * pf) / dE,
  } : { solar: 0, solarBatt: 0, grid: s.price, diesel: s.dieselCost, solarGrants: 0 };

  // Optimisation sweeps
  const covs = []; for (let c = LIMITS.cov[0]; c <= LIMITS.cov[1]; c += 5) covs.push(c);
  const covSweep = covs.map(cov => {
    const sc = { ...s, cov }, ec = annualEnergy(sc), k = economicsFor(sc, ec);
    return { cov, co2t: ec.gen * C.CO2_KG_PER_KWH / 1000, saving: k.saving, payback: k.paybackAfter };
  });
  const best = covSweep.reduce((a, b) => (b.payback < a.payback ? b : a));
  const yearGen = o => sum(MDAYS.map((days, m) => dayGeneration(midDoy(m), monthlyKt(m, s), s, o).total * days));
  const tilts = []; for (let t = 0; t <= 45; t += 2.5) tilts.push(t);
  const sunward = s.lat >= 0 ? 0 : 180;
  const tiltSweep = tilts.map(t => ({ tilt: t, mwh: yearGen({ tilt: t, orient: sunward }) / 1000 }));
  const compass = [['N', 180], ['NE', -135], ['E', -90], ['SE', -45], ['S', 0], ['SW', 45], ['W', 90], ['NW', 135]];
  const orientRaw = compass.map(([l, a]) => ({ label: l, az: a, kwh: yearGen({ orient: a }) }));
  const orientMax = Math.max(...orientRaw.map(o => o.kwh), 1e-9);
  const orientSweep = orientRaw.map(o => ({ ...o, pct: o.kwh / orientMax * 100 }));
  const current = yearGen({});

  return {
    state: s, size, month, effPrice, climate: s.clim,
    day: { kt, hourly: day.hourly, total: day.total, peak: day.peak, sim: daySim },
    annual: {
      genKwh: e.gen, loadKwh: e.load, exportKwh: e.export, importKwh: e.import, avoidedKwh: e.avoided,
      selfConsumption: e.gen > 0 ? (e.gen - e.export) / e.gen * 100 : 0,
      solarFraction: e.load > 0 ? e.avoided / e.load * 100 : 0,
      specificYield: size.kWp > 0 ? e.gen / size.kWp : 0,
      co2t: e.gen * C.CO2_KG_PER_KWH / 1000,
      battCycles: e.cycles,
      ghiYear: sum(s.clim.ghi.map((g, m) => g * MDAYS[m])),
      orientPct: current / orientMax * 100, // current facing vs best of 8 compass directions
    },
    monthly, noTempMonthly,
    economics: { ...eco, loanPayment, cashflow: eco.net - loanPayment, npv25: npv.mid[C.LIFE_YRS],
      wbEligible: eco.netCapex * C.WB_SHARE, ifcCover: eco.capex * C.IFC_COVER,
      battExtraSaving, battPayback: payback(eco.battCapex, battExtraSaving - eco.battCapex * C.OM_RATE) },
    lcoe, npv,
    sweeps: { cov: covSweep, bestCov: best.cov, tilt: tiltSweep, orient: orientSweep },
  };
}

// Daily generation for every day of the year (long-term average weather) — heat map.
export function yearDaily(input, clim = DEFAULT_CLIMATE) {
  const s = { ...sanitizeState(input), clim };
  return Array.from({ length: 365 }, (_, i) => dayGeneration(i + 1, monthlyKt(doyToMonth(i + 1), s), s).total);
}

// ── state (URL sharing) ────────────────────────────────────────────────────
const INT_KEYS = new Set(['doy', 'workDays', 'dutyOn', 'euOn']);

export function sanitizeState(input = {}) {
  const s = { ...DEFAULTS };
  for (const [k, v] of Object.entries(input)) {
    if (!(k in DEFAULTS)) continue;
    if (k in ENUMS) { if (ENUMS[k].includes(v)) s[k] = v; continue; }
    const n = Number(v);
    if (v === '' || v === null || !Number.isFinite(n)) continue;
    const [lo, hi] = LIMITS[k];
    s[k] = clamp(INT_KEYS.has(k) ? Math.round(n) : n, lo, hi);
  }
  return s;
}

export function encodeState(s) {
  const p = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) p.set(k, s[k]);
  return p.toString();
}

export function decodeState(str) {
  return sanitizeState(Object.fromEntries(new URLSearchParams(str.replace(/^#/, ''))));
}

export function monthlyCsv(r) {
  const rows = [['Month', 'Generation kWh', 'Load kWh', 'Export kWh', 'Grid import kWh', 'Self-consumption %', 'Solar fraction %']];
  r.monthly.forEach(m => rows.push([m.month, m.genKwh.toFixed(1), m.loadKwh.toFixed(1), m.exportKwh.toFixed(1),
    m.importKwh.toFixed(1), m.selfConsumption.toFixed(1), m.solarFraction.toFixed(1)]));
  rows.push([]);
  rows.push(['Location', `"${r.climate.name}"`]);
  rows.push(['Climate source', `"${r.climate.source}"`]);
  rows.push(['Parameter', 'Value']);
  Object.entries(r.state).forEach(([k, v]) => { if (k !== 'clim') rows.push([k, v]); });
  return rows.map(r => r.join(',')).join('\n');
}
