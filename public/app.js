import {
  C, MN, MDAYS, DEFAULTS, LIMITS, ENUMS, WEATHER, SHIFTS, ORIENTATIONS,
  runModel, yearDaily, systemSize, loadProfile, encodeState, decodeState, monthlyCsv, clamp,
} from './model.js';

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
  { sect: 'Selected day' },
  { key: 'doy', label: 'Day of year', fmt: v => `${v} · ${fmtDate(v)}` },
  { key: 'wx', label: 'Weather (selected day only)', options: Object.entries(WEATHER).map(([v, w]) => ({ v, label: w.label })) },
  { sect: 'Roof & panels' },
  { key: 'pitch', label: 'Panel tilt', fmt: v => v + '°' },
  { key: 'orient', label: 'Orientation (facing)', options: ORIENTATIONS },
  { key: 'eff', label: 'Panel efficiency', fmt: v => v.toFixed(1) + '%' },
  { key: 'area', label: 'Total roof area', num: 'm²' },
  { key: 'cov', label: 'Panel coverage', fmt: v => v + '%' },
  { key: 'soiling', label: 'Dust / soiling loss', fmt: v => v + '%', hint: 'Iraq: 3–8% with regular cleaning, 15%+ without' },
  { key: 'temp', label: 'Extra derating', fmt: v => (v === 0 ? 'None' : v + '%'), hint: 'On top of the modelled temperature loss' },
  { sect: 'Factory load' },
  { key: 'load', label: 'Load during operating hours', num: 'kW' },
  { key: 'shift', label: 'Operating hours', options: Object.entries(SHIFTS).map(([v, s]) => ({ v, label: s.label })) },
  { key: 'workDays', label: 'Operating days per week', fmt: v => v + ' days', hint: 'Closed days run at 15% base load' },
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

function buildControls() {
  const root = $('controls-body');
  root.innerHTML = CONTROLS.map(c => {
    if (c.sect) return `<div class="sect">${c.sect}</div>`;
    const id = 'in-' + c.key;
    if (c.check) return `<div class="fld"><label class="chk"><input type="checkbox" id="${id}" data-key="${c.key}"> ${c.label}</label></div>`;
    const [lo, hi] = LIMITS[c.key] || [];
    const value = c.num
      ? `<span class="fv"><input type="number" class="num" id="num-${c.key}" data-key="${c.key}" min="${lo}" max="${hi}" step="any" inputmode="decimal" aria-label="${c.label} (${c.num})"> ${c.num}</span>`
      : c.fmt ? `<span class="fv" id="v-${c.key}"></span>` : '';
    const head = `<div class="fl"><label for="${id}">${c.label}</label>${value}</div>`;
    const input = c.options
      ? `<select id="${id}" data-key="${c.key}">${c.options.map(o => `<option value="${o.v}">${o.label}</option>`).join('')}</select>`
      : `<input type="range" id="${id}" data-key="${c.key}" min="${LIMITS[c.key][0]}" max="${LIMITS[c.key][1]}" step="${LIMITS[c.key][2]}"${c.hint ? ` title="${c.hint}"` : ''}>`;
    return `<div class="fld">${head}${input}</div>`;
  }).join('');
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
}

function onInput(e) {
  const el = e.target, k = el.dataset.key;
  if (!k) return;
  let v;
  if (el.type === 'checkbox') v = el.checked ? 1 : 0;
  else if (k in ENUMS) v = el.value;
  else {
    v = parseFloat(el.value);
    if (!Number.isFinite(v)) { if (e.type === 'change') syncControls(); return; } // empty box: restore on blur
    if (LIMITS[k]) {                            // orientation is a fixed option list, no range
      const [lo, hi] = LIMITS[k];
      if (el.type === 'number' && e.type === 'input' && (v < lo || v > hi)) return; // wait for blur to clamp
      v = clamp(v, lo, hi);
    }
  }
  S[k] = v;
  // Don't rewrite the number box the user is typing in; do clamp it once they leave it
  syncControls(el.type === 'number' && e.type === 'input' ? el : null);
  scheduleRender();
}

function syncControls(skip = null) {
  for (const c of CONTROLS) {
    if (!c.key) continue;
    const el = $('in-' + c.key);
    if (c.check) el.checked = !!S[c.key];
    else if (el !== skip) el.value = S[c.key];
    const num = c.num && $('num-' + c.key);
    if (num && num !== skip) num.value = S[c.key];
  }
  syncLabels();
}
function syncLabels() {
  for (const c of CONTROLS) if (c.fmt) $('v-' + c.key).textContent = c.fmt(S[c.key]);
}

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
    { type: 'line', label: 'Factory load', data: [], borderColor: COL.redD, borderWidth: 1.5, pointRadius: 0, stepped: 'middle', order: 0 },
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
  const r = runModel(S);
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
  setData('c1', loadProfile(S.load, S.shift), r2(day.hourly));
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
      ? 'Solar output rarely exceeds the factory load at these settings, so there is little surplus to store. Increase roof area/coverage or reduce load to see battery value.'
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
  const key = ['pitch', 'orient', 'eff', 'area', 'cov', 'soiling', 'temp'].map(k => S[k]).join('|');
  if (key === hmKey) return;
  hmKey = key;
  const daily = yearDaily(S);
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
  text('roofstats', `${fmt(panelArea, panelArea < 100 ? 1 : 0)} m² covered · ${fmt(panelCount)} panels · tilt ${pitch}°${slots > cols * rows ? ' · not to scale' : ''}`);
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
  // Charts in hidden panels have zero size until shown
  Object.values(CHARTS).forEach(c => c.canvas.closest('.panel.active') && c.resize());
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
$('btn-reset').addEventListener('click', () => { S = { ...DEFAULTS }; syncControls(); render(); toast('Inputs reset to defaults'); });
window.addEventListener('hashchange', () => { S = decodeState(location.hash); syncControls(); render(); });
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
S = decodeState(location.hash);
buildControls();
syncControls();
if (typeof Chart === 'undefined') {
  document.body.insertAdjacentHTML('afterbegin', '<p class="note warn" style="margin:8px">Charts failed to load. Please refresh.</p>');
} else {
  initCharts();
  render();
}
