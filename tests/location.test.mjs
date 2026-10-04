// Unit tests for locations, roof drawing geometry and house mode. Run: npm run test:unit
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/model.js';
import * as G from '../public/geo.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const city = n => M.CITIES.find(c => c.name === n);
const climateFor = n => ({ ...city(n), source: 'test' });
const at = (n, over = {}) => M.runModel({ ...M.DEFAULTS, lat: city(n).lat, lon: city(n).lon, ...over }, climateFor(n));

// Rectangle of w × h metres (x = east, y = north), optionally rotated clockwise by rot degrees
function rect(w, h, rot = 0, lat0 = 33.3, lon0 = 44.4) {
  const r = rot * Math.PI / 180, ky = 1 / 111195, kx = 1 / (111195 * Math.cos(lat0 * Math.PI / 180));
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => {
    const xr = x * Math.cos(r) + y * Math.sin(r), yr = -x * Math.sin(r) + y * Math.cos(r);
    return { lat: lat0 + yr * ky, lng: lon0 + xr * kx };
  });
}

describe('azimuth conventions', () => {
  test('compass bearing ↔ model azimuth', () => {
    assert.equal(G.bearingToAzimuth(180), 0);   // south
    assert.equal(G.bearingToAzimuth(90), -90);  // east
    assert.equal(G.bearingToAzimuth(270), 90);  // west
    assert.equal(Math.abs(G.bearingToAzimuth(0)), 180); // north
    for (const az of [-179, -90, 0, 45, 180]) near(G.bearingToAzimuth(G.azimuthToBearing(az)), az === -179 ? -179 : az, 1e-9);
  });

  test('labels read as compass directions', () => {
    assert.equal(G.azimuthLabel(0), 'S · 180°');
    assert.equal(G.azimuthLabel(-90), 'E · 90°');
    assert.equal(G.azimuthLabel(90), 'W · 270°');
    assert.equal(G.compassName(200), 'SSW');
  });
});

describe('roof drawing geometry', () => {
  test('rectangle area and perimeter are measured accurately', () => {
    const g = G.roofGeometry(rect(15, 10));
    near(g.area, 150, 0.5);
    near(g.perimeter, 50, 0.1);
  });

  test('area is independent of rotation and of vertex order', () => {
    for (const rot of [0, 17, 45, 90, 133]) near(G.polygonArea(rect(20, 8, rot)), 160, 0.5, `rot ${rot}`);
    near(G.polygonArea(rect(20, 8).reverse()), 160, 0.5);
  });

  test('L-shaped roof (concave) area', () => {
    const k = 1 / 111195, kx = 1 / (111195 * Math.cos(33.3 * Math.PI / 180));
    const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]].map(([x, y]) => ({ lat: 33.3 + y * k, lng: 44.4 + x * kx }));
    near(G.polygonArea(L), 10 * 4 + 4 * 6, 0.3);
  });

  test('a small house roof (8 × 12 m) is measured to within 1%', () => {
    near(G.polygonArea(rect(12, 8, 30)), 96, 0.96);
  });

  test('ridge running east–west → panels face south, other side north', () => {
    const g = G.roofGeometry(rect(15, 10), 33.3);
    near(Math.abs(g.facing), 0, 1e-6);
    near(Math.abs(g.altFacing), 180, 1e-6);
  });

  test('ridge running north–south → panels face east or west', () => {
    const g = G.roofGeometry(rect(6, 20), 33.3);
    near(Math.abs(g.facing), 90, 1e-6);
  });

  test('rotated building: suggested facing is perpendicular to the long edge and sun-ward', () => {
    const g = G.roofGeometry(rect(20, 8, 30), 33.3);   // long edge bearing 120° → faces 210° (SSW) or 30°
    near(G.azimuthToBearing(g.facing), 210, 0.5);
    near(G.azimuthToBearing(g.altFacing), 30, 0.5);
  });

  test('fewer than 3 points → no roof', () => {
    assert.equal(G.roofGeometry(rect(5, 5).slice(0, 2)), null);
    assert.equal(G.polygonArea([]), 0);
  });
});

describe('locations & climate', () => {
  test('20 built-in Iraqi cities with complete NASA POWER data', () => {
    assert.equal(M.CITIES.length, 20);
    for (const c of M.CITIES) {
      assert.equal(c.ghi.length, 12); assert.equal(c.tamb.length, 12);
      const annual = c.ghi.reduce((a, g, m) => a + g * M.MDAYS[m], 0);
      assert.ok(annual > 1700 && annual < 2200, `${c.name} GHI ${annual}`);
      assert.ok(c.lat > 29 && c.lat < 37.5 && c.lon > 38.5 && c.lon < 48.6, `${c.name} inside Iraq`);
    }
  });

  test('nearest city lookup', () => {
    assert.equal(G.nearestCity(33.33, 44.40, M.CITIES).city.name, 'Baghdad');
    assert.equal(G.nearestCity(30.5, 47.8, M.CITIES).city.name, 'Basra');
    near(G.haversine({ lat: 33.315, lon: 44.366 }, { lat: 30.508, lon: 47.783 }), 449, 10, 'Baghdad–Basra km');
  });

  test('sunnier, southern Basra out-produces northern Zakho for the same system', () => {
    assert.ok(at('Basra').annual.genKwh > at('Zakho').annual.genKwh * 1.08);
  });

  test('hotter Basra loses more output to heat than cooler Duhok', () => {
    const loss = r => 1 - r.monthly[6].genKwh / r.noTempMonthly[6];
    assert.ok(loss(at('Basra')) > loss(at('Duhok')));
  });

  test('optimal tilt rises with latitude (Basra → Zakho)', () => {
    const bestTilt = r => r.sweeps.tilt.reduce((a, b) => (b.mwh > a.mwh ? b : a)).tilt;
    assert.ok(bestTilt(at('Zakho')) >= bestTilt(at('Basra')) - 2.5);
  });

  test('south still best and north worst everywhere in Iraq', () => {
    for (const c of M.CITIES) {
      const o = at(c.name).sweeps.orient;
      const pct = l => o.find(x => x.label === l).pct;
      assert.ok(pct('S') >= 99.9 || pct('SE') >= 99.9 || pct('SW') >= 99.9, `${c.name} best is southerly`);
      assert.ok(pct('N') < pct('E') && pct('N') < pct('W'), `${c.name} north worst`);
    }
  });

  test('POWER response parser accepts valid data and rejects missing values', () => {
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const mk = (g, t) => ({ properties: { parameter: {
      ALLSKY_SFC_SW_DWN: Object.fromEntries(MONTHS.map(m => [m, g])), T2M: Object.fromEntries(MONTHS.map(m => [m, t])) } } });
    assert.deepEqual(G.parsePower(mk(5.123, 25.04)).ghi[0], 5.12);
    assert.throws(() => G.parsePower(mk(-999, 25)));
    assert.throws(() => G.parsePower({}));
  });

  test('a link with only building=house gets house defaults; round-trips are exact', () => {
    const s = M.decodeState('#building=house');
    assert.equal(s.area, M.PRESETS.house.area);
    assert.equal(s.houseKwh, M.PRESETS.house.houseKwh);
    // a house value that equals the *factory* default must survive the round trip
    const h = { ...s, cov: M.DEFAULTS.cov, pitch: 33 };
    assert.deepEqual(M.decodeState('#' + M.encodeState(h)), h);
    assert.equal(M.encodeState(s), 'building=house');
  });

  test('URL state carries location and is clamped', () => {
    const s = M.decodeState('#lat=36.19&lon=44.01&building=house');
    assert.equal(s.lat, 36.19); assert.equal(s.lon, 44.01); assert.equal(s.building, 'house');
    assert.equal(M.decodeState('#lat=95').lat, 70);
  });

  test('continuous orientation: any azimuth works and is symmetric about south', () => {
    const a = at('Baghdad', { orient: -30, pitch: 30 }).annual.genKwh, b = at('Baghdad', { orient: 30, pitch: 30 }).annual.genKwh;
    near(a / b, 1, 0.03);
    assert.ok(at('Baghdad', { orient: 17 }).annual.genKwh > 0);
  });
});

describe('house mode', () => {
  const house = (over = {}) => M.runModel({ ...M.DEFAULTS, building: 'house', ...M.PRESETS.house, ...over });

  test('household load profile sums to the daily consumption on an average day', () => {
    const s = { ...M.DEFAULTS, building: 'house', houseKwh: 30 };
    const yearly = M.MDAYS.reduce((a, d, m) => a + M.loadProfile(s, true, m).reduce((x, y) => x + y, 0) * d, 0);
    near(yearly, 30 * 365, 30 * 365 * 0.01);
  });

  test('house load peaks in the evening and in summer', () => {
    const s = { ...M.DEFAULTS, building: 'house', houseKwh: 30 };
    const jul = M.loadProfile(s, true, 6), apr = M.loadProfile(s, true, 3);
    assert.ok(jul[19] > jul[3] * 2);
    assert.ok(jul.reduce((a, b) => a + b) > apr.reduce((a, b) => a + b) * 1.5);
  });

  test('house defaults give a realistic home system', () => {
    const r = house();
    assert.ok(r.size.kWp > 5 && r.size.kWp < 15, `kWp ${r.size.kWp}`);
    near(r.annual.loadKwh, 30 * 365, 120);
    assert.ok(Number.isFinite(r.economics.paybackAfter) && r.economics.paybackAfter < 20);
  });

  test('factory-only inputs (shift, days) do not affect a house', () => {
    const a = house({ shift: 'day', workDays: 5 }).economics.saving;
    const b = house({ shift: '24h', workDays: 7 }).economics.saving;
    near(a, b, 1e-6);
  });

  test('a battery raises a home’s solar fraction (evening peak)', () => {
    assert.ok(house({ batt: 10 }).annual.solarFraction > house({ batt: 0 }).annual.solarFraction + 5);
  });
});
