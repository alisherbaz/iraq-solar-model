// Shared helpers for the Playwright specs.
import { expect } from '@playwright/test';

export const isMobile = testInfo => testInfo.project.name !== 'desktop';

// External services are mocked so tests are fast, deterministic and work offline.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const powerFixture = (ghi = 6, t = 25) => ({ properties: { parameter: {
  ALLSKY_SFC_SW_DWN: Object.fromEntries(MONTHS.map(m => [m, ghi])), T2M: Object.fromEntries(MONTHS.map(m => [m, t])) } } });
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export async function mockServices(page, { power = powerFixture(), powerFail = false } = {}) {
  const calls = { power: 0, search: 0 };
  await page.route('https://power.larc.nasa.gov/**', route => {
    calls.power++;
    return powerFail ? route.abort() : route.fulfill({ json: power });
  });
  await page.route('https://nominatim.openstreetmap.org/**', route => {
    calls.search++;
    return route.fulfill({ json: [{ lat: '36.1912', lon: '44.0094', display_name: 'Erbil, Erbil Governorate, Iraq' }] });
  });
  await page.route('https://server.arcgisonline.com/**', route => route.fulfill({ body: PNG_1PX, contentType: 'image/png' }));
  return calls;
}

// Loads the app (with mocked services) and returns the list of console/page errors.
export async function load(page, hash = '', mocks) {
  if (!page.__calls) page.__calls = await mockServices(page, mocks);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./' + hash); // relative, so it works when the site is served from a sub-path (GitHub Pages)
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  // Netlify injects its own HUD script (/.netlify/scripts/hud) whose inline code our CSP deliberately blocks.
  // Ignore only that CSP report, and only when Netlify's script is present — any other error still fails.
  const netlifyHud = await page.locator('script[src*="/.netlify/scripts/"]').count();
  if (netlifyHud) return errors.filter(e => !/^Executing inline script violates the following Content Security Policy/.test(e));
  return errors;
}

export async function openInputs(page, testInfo) {
  if (isMobile(testInfo)) {
    await page.locator('#btn-open-controls').click();
    await expect(page.locator('#controls')).toHaveClass(/open/);
  }
}

export async function closeInputs(page, testInfo) {
  if (isMobile(testInfo)) await page.locator('#btn-close-controls').click();
}

export const nextFrame = page =>
  page.waitForFunction(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));

// Sets an input the way a user would. Log-scale sliders (area, load) are set via their number box.
export async function setInput(page, key, value) {
  const box = page.locator('#num-' + key);
  const target = (await box.count()) ? box : page.locator('#in-' + key);
  await target.evaluate((el, v) => {
    el.value = v;
    const evt = el.tagName === 'SELECT' || el.type === 'number' || el.type === 'date' ? 'change' : 'input';
    el.dispatchEvent(new Event(evt, { bubbles: true }));
  }, String(value));
  await nextFrame(page);
}

export const metric = (page, k) => page.locator(`[data-m="${k}"]`);
export const num = async loc => Number((await loc.textContent()).replace(/[^0-9.\-]/g, ''));
