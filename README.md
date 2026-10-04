# ☀️ Iraq Solar Factory Model

**Live:** https://nebosolutions.co.uk/solar/ (main) · https://iraq-solar-model.netlify.app (Netlify) · https://alisherbaz.github.io/iraq-solar-model/ (GitHub Pages)

Manual Netlify deploy (runs the unit tests first): `npx netlify-cli deploy --build --prod`

An interactive, mobile-friendly model of rooftop solar PV, battery storage and project financing for a factory in Baghdad, Iraq. It's a static site with no build step and no backend.

**Tabs:** Location & roof · Generation · Battery · Optimisation (coverage, tilt, orientation, heat) · Financing (grants, LCOE, NPV) · Method

**Houses and factories, anywhere in Iraq:**
- Pick one of 20 built-in Iraqi cities, search for an address, use GPS, or tap the satellite map.
- Climate (monthly irradiation and temperature) comes from **NASA POWER**. It's fetched live for any map point and cached in the browser. Built-in city data is the offline fallback (`npm run climate` refreshes it).
- **Draw the roof** on the satellite image. The app measures the area and works out which way the roof faces: flat roofs get south-facing racks, and pitched roofs face perpendicular to the ridge, with a switch to use the other side.
- A **house mode** adds an Iraqi household load profile (evening peak, summer air-conditioning) and generator-subscription pricing.

External services: NASA POWER (climate), OpenStreetMap Nominatim (search) and Esri World Imagery (satellite tiles). None need an API key. Google Maps would need a billing-enabled API key, so the app links to Google Maps for the chosen spot instead.

## Run locally

Requires Node.js 20 or later.

```bash
npm install
npm start            # → http://localhost:5173
```

## Tests

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | 40+ checks on the model maths (solar geometry, yield, battery energy balance, economics, URL state). Takes about 1 s. |
| `npm run test:e2e` | Playwright browser tests on **desktop, Pixel 7 and a 320 px phone**. Covers tabs, charts, inputs, share links, CSV export, the mobile input sheet and horizontal overflow. |
| `npm test` | Both suites. |
| `BASE_URL=https://<site>.netlify.app npm run test:smoke` | `@smoke` subset against a live deploy. |

The first time you run the E2E tests, install the browser with `npx playwright install chromium`.

### Tests on every redeploy

- **GitHub Pages** (`.github/workflows/pages.yml`) deploys `public/` on every push to `main`, but only after the unit and E2E tests pass.
- **Netlify** runs `npm run test:unit` as its build command (`netlify.toml`). If a test fails, the deploy aborts and the previous version stays live.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs the unit tests and the full desktop + mobile E2E suite on every push and pull request. You can also start the workflow manually with a `base_url` to smoke-test the live site.

## Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
2. The settings are read from `netlify.toml` (publish `public/`, build command `npm run test:unit`). Nothing else needs configuring.

## Project layout

```
public/            ← the deployed site
  index.html
  styles.css
  model.js         ← pure calculation core (no DOM) — shared with the tests
  app.js           ← UI, charts, URL state
  vendor/          ← Chart.js (self-hosted; refresh with `npm run vendor`)
tests/
  model.test.mjs   ← unit tests (node:test)
  e2e/app.spec.mjs ← Playwright tests
scripts/serve.mjs  ← zero-dependency local server (sends the production CSP)
reference/         ← the original single-file model, kept for comparison
```

## Model notes

- **Irradiation:** Baghdad long-term monthly GHI (about 2,100 kWh/m²/yr) → Erbs diffuse split → isotropic-sky transposition onto the tilted plane, simulated in 15-minute steps.
- **Losses:** hourly cell temperature (NOCT 45 °C, −0.4 %/°C), dust/soiling (an input), and a 14 % balance-of-system loss.
- **Battery:** hourly dispatch (solar → load → battery → export), with a 0.5C limit and steady-state daily cycling.
- **Economics:** savings = avoided grid purchases + export credit; O&M 1 %/yr; 0.5 %/yr degradation; 8 % discount rate; 25-year life.
- **Grants:** programme figures are **indicative and unverified**. Confirm with each institution before relying on them.

The model is for screening only. Validate with a site-specific PVGIS or PVsyst study before investing.
