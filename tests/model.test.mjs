// Unit tests for the calculation core. Run: npm run test:unit
// These run on every Netlify deploy (see netlify.toml) — a failure blocks the deploy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/model.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const base = M.runModel(M.DEFAULTS);

describe('solar geometry', () => {
  test('declination at solstices and equinox', () => {
    near(M.declination(172), 23.45, 0.1, 'June solstice');
    near(M.declination(355), -23.45, 0.1, 'December solstice');
    near(M.declination(81), 0, 0.5, 'March equinox');
  });

  test('sun is due south at solar noon, east in morning, west in afternoon', () => {
    near(M.sunPosition(172, 12).azimuth, 0, 1e-6);
    assert.ok(M.sunPosition(172, 9).azimuth < 0, 'morning sun should be east (negative)');
    assert.ok(M.sunPosition(172, 15).azimuth > 0, 'afternoon sun should be west (positive)');
  });

  test('noon elevation matches 90 - lat + declination', () => {
    near(M.sunPosition(172, 12).elevation, 90 - M.SITE.lat + M.declination(172), 0.01);
  });

  test('sunrise/sunset symmetric around noon; summer days longer', () => {
    const jun = M.sunriseSunset(172), dec = M.sunriseSunset(355);
    near(jun.rise + jun.set, 24, 1e-9);
    assert.ok(jun.set - jun.rise > 14 && dec.set - dec.rise < 10.5);
  });

  test('horizontal panel sees GHI: annual model reproduces input irradiation', () => {
    const ghi = M.MDAYS.reduce((a, d, m) => a + M.dayGeneration(M.midDoy(m), M.monthlyKt(m), { ...M.DEFAULTS, pitch: 0 }).ghi * d, 0);
    const input = M.MDAYS.reduce((a, d, m) => a + M.GHI[m] * d, 0);
    near(ghi, input, input * 0.005);
  });

  test('Erbs diffuse fraction is bounded and decreasing', () => {
    let prev = 1;
    for (let kt = 0; kt <= 1; kt += 0.05) {
      const f = M.diffuseFraction(kt);
      assert.ok(f > 0 && f <= 1 && f <= prev + 1e-9);
      prev = f;
    }
  });
});

describe('PV yield (regression guards against orientation/tilt bugs)', () => {
  const annual = over => M.annualEnergy({ ...M.DEFAULTS, ...over }).gen;

  test('south-facing beats north-facing by a wide margin', () => {
    assert.ok(annual({ orient: 0, pitch: 30 }) > annual({ orient: 180, pitch: 30 }) * 1.15);
  });

  test('east and west are near-symmetric; east slightly ahead (cooler mornings)', () => {
    const e = annual({ orient: -90, pitch: 30 }), w = annual({ orient: 90, pitch: 30 });
    assert.ok(e >= w && e / w < 1.03, `east/west = ${e / w}`);
  });

  test('optimal annual tilt for Baghdad is between 25° and 35°', () => {
    const best = base.sweeps.tilt.reduce((a, b) => (b.mwh > a.mwh ? b : a));
    assert.ok(best.tilt >= 25 && best.tilt <= 35, `best tilt ${best.tilt}`);
  });

  test('tilted south panel out-produces flat panel', () => {
    assert.ok(annual({ pitch: 30 }) > annual({ pitch: 0 }));
  });

  test('specific yield is realistic for central Iraq (1,500–1,950 kWh/kWp)', () => {
    const y = base.annual.specificYield;
    assert.ok(y > 1500 && y < 1950, `specific yield ${y}`);
  });

  test('summer months out-produce winter months', () => {
    assert.ok(base.monthly[5].genKwh > base.monthly[11].genKwh * 1.5);
  });

  test('output scales linearly with area, coverage and efficiency', () => {
    const a = annual({}), b = annual({ area: 10000 }), c = annual({ eff: 22 });
    near(b / a, 2, 1e-6);
    near(c / a, 22 / 20, 1e-6);
  });

  test('soiling reduces output proportionally', () => {
    near(annual({ soiling: 10 }) / annual({ soiling: 0 }), 0.9, 1e-6);
  });

  test('heat losses are positive and largest in summer', () => {
    const lossPct = m => 1 - base.monthly[m].genKwh / base.noTempMonthly[m];
    assert.ok(lossPct(6) > lossPct(0) && lossPct(6) > 0.05 && lossPct(6) < 0.25);
  });

  test('clear day produces more than dusty day which beats overcast', () => {
    const d = wx => M.runModel({ ...M.DEFAULTS, wx }).day.total;
    assert.ok(d('clear') > d('dusty') && d('dusty') > d('overcast'));
  });

  test('peak hourly output never exceeds system kWp', () => {
    for (const wx of Object.keys(M.WEATHER)) {
      const r = M.runModel({ ...M.DEFAULTS, wx, pitch: 30 });
      assert.ok(r.day.peak <= r.size.kWp, `${wx}: ${r.day.peak} > ${r.size.kWp}`);
    }
  });

  test('no generation at night', () => {
    const h = base.day.hourly;
    [0, 1, 2, 3, 22, 23].forEach(i => assert.equal(h[i], 0));
  });
});

describe('battery dispatch', () => {
  const gen = Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 17 ? 1000 * Math.sin(Math.PI * (h - 6) / 12) : 0));
  const load = M.loadProfile(400);

  for (const cap of [0, 500, 2000]) {
    test(`energy balance holds (capacity ${cap} kWh)`, () => {
      const s = M.simulateDay(gen, load, cap, 90);
      for (let h = 0; h < 24; h++) {
        near(s.direct[h] + s.charge[h] + s.export[h], gen[h], 1e-9, `gen h${h}`);
        near(s.direct[h] + s.discharge[h] + s.import[h], load[h], 1e-9, `load h${h}`);
        assert.ok(s.soc[h] >= -1e-9 && s.soc[h] <= cap + 1e-9, `soc h${h}`);
        assert.ok(s.charge[h] <= cap * M.C.BATT_C_RATE + 1e-9 && s.discharge[h] <= cap * M.C.BATT_C_RATE + 1e-9);
      }
      // Steady state: battery never delivers more than it absorbed (round-trip losses)
      assert.ok(s.totals.discharge <= s.totals.charge * 0.9 + 1e-6);
    });
  }

  test('no battery → no charge or discharge', () => {
    const s = M.simulateDay(gen, load, 0, 90);
    assert.equal(s.totals.charge, 0);
    assert.equal(s.totals.discharge, 0);
  });

  test('a bigger battery never lowers solar fraction or raises grid import', () => {
    let prev = M.annualEnergy({ ...M.DEFAULTS, area: 20000 }, 0);
    for (const b of [500, 1000, 2000, 4000]) {
      const e = M.annualEnergy({ ...M.DEFAULTS, area: 20000 }, b);
      assert.ok(e.import <= prev.import + 1e-6);
      prev = e;
    }
  });

  test('battery adds value when there is surplus solar', () => {
    const r = M.runModel({ ...M.DEFAULTS, area: 20000, load: 800, batt: 2000 });
    assert.ok(r.economics.battExtraSaving > 0);
    assert.ok(r.annual.battCycles > 50);
  });
});

describe('economics', () => {
  const e = base.economics;

  test('grants never exceed capex and net cost is non-negative', () => {
    for (const grant of [0, 30, 60]) {
      const r = M.runModel({ ...M.DEFAULTS, grant });
      assert.ok(r.economics.grants.total <= r.economics.capex);
      assert.ok(r.economics.netCapex >= 0);
    }
  });

  test('grants shorten payback', () => {
    assert.ok(e.paybackAfter < e.paybackBefore);
  });

  test('savings increase with electricity price', () => {
    const lo = M.runModel({ ...M.DEFAULTS, price: 0.06 }).economics.saving;
    const hi = M.runModel({ ...M.DEFAULTS, price: 0.20 }).economics.saving;
    assert.ok(hi > lo);
  });

  test('savings never exceed the cost of buying all factory load at grid price plus export value', () => {
    assert.ok(e.saving <= base.annual.loadKwh * M.DEFAULTS.price + base.annual.exportKwh * M.DEFAULTS.exportTariff + 1e-6);
  });

  test('NPV starts at minus net capex and rises over time', () => {
    assert.equal(base.npv.mid[0], -e.netCapex);
    assert.ok(base.npv.mid[25] > base.npv.mid[0]);
    assert.ok(base.npv.high[25] > base.npv.mid[25] && base.npv.mid[25] > base.npv.low[25]);
  });

  test('loan annuity at 0% equals principal / years', () => {
    const r = M.runModel({ ...M.DEFAULTS, loan: 0 });
    near(r.economics.loanPayment, r.economics.netCapex / M.C.LOAN_YRS, 1e-6);
  });

  test('LCOE is in a plausible range and grants reduce it', () => {
    assert.ok(base.lcoe.solar > 0.02 && base.lcoe.solar < 0.12, `lcoe ${base.lcoe.solar}`);
    assert.ok(base.lcoe.solarGrants < base.lcoe.solar);
    assert.ok(base.lcoe.solarBatt >= base.lcoe.solar);
  });

  test('payback is finite and reasonable for defaults', () => {
    assert.ok(Number.isFinite(e.paybackAfter) && e.paybackAfter > 1 && e.paybackAfter < 20);
  });

  test('CO₂ offset uses the grid factor', () => {
    near(base.annual.co2t, base.annual.genKwh * M.C.CO2_KG_PER_KWH / 1000, 1e-9);
  });
});

describe('model robustness', () => {
  test('every slider at its min and max produces finite results', () => {
    for (const [k, [lo, hi]] of Object.entries(M.LIMITS)) {
      for (const v of [lo, hi]) {
        const r = M.runModel({ ...M.DEFAULTS, [k]: v });
        for (const x of [r.annual.genKwh, r.economics.saving, r.economics.netCapex, r.lcoe.solar, r.day.total]) {
          assert.ok(Number.isFinite(x) && x >= 0, `${k}=${v} gave ${x}`);
        }
      }
    }
  });

  test('every orientation and weather option runs', () => {
    for (const o of M.ORIENTATIONS) for (const wx of Object.keys(M.WEATHER)) {
      assert.ok(Number.isFinite(M.runModel({ ...M.DEFAULTS, orient: o.v, wx }).day.total));
    }
  });

  test('full model runs fast enough for live slider updates (< 150 ms)', () => {
    const t = performance.now();
    M.runModel({ ...M.DEFAULTS, batt: 2000 });
    assert.ok(performance.now() - t < 150);
  });

  test('yearDaily returns 365 positive values', () => {
    const d = M.yearDaily(M.DEFAULTS);
    assert.equal(d.length, 365);
    assert.ok(d.every(v => v > 0));
  });
});

describe('state sharing', () => {
  test('defaults encode to an empty string', () => {
    assert.equal(M.encodeState(M.DEFAULTS), '');
  });

  test('encode → decode round-trips', () => {
    const s = { ...M.DEFAULTS, pitch: 30, wx: 'dusty', orient: -45, price: 0.15, batt: 1200 };
    assert.deepEqual(M.decodeState('#' + M.encodeState(s)), s);
  });

  test('decode clamps out-of-range and ignores junk', () => {
    const s = M.decodeState('#pitch=999&area=-5&wx=hacked&orient=17&foo=bar&eff=abc');
    assert.equal(s.pitch, 45);
    assert.equal(s.area, 500);
    assert.equal(s.wx, M.DEFAULTS.wx);
    assert.equal(s.orient, M.DEFAULTS.orient);
    assert.equal(s.eff, M.DEFAULTS.eff);
    assert.ok(!('foo' in s));
  });

  test('CSV export has a header, 12 months and the parameters', () => {
    const lines = M.monthlyCsv(base).split('\n');
    assert.match(lines[0], /^Month,Generation kWh/);
    assert.equal(lines.slice(1, 13).length, 12);
    assert.ok(lines.some(l => l.startsWith('pitch,')));
  });
});
