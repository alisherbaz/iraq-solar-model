// End-to-end tests for location, map search, roof drawing and house mode.
import { test, expect } from '@playwright/test';
import { isMobile, load, openInputs, closeInputs, setInput, metric, num, nextFrame, powerFixture } from './helpers.mjs';

async function openMap(page) {
  await page.locator('.tab[data-tab="location"]').click();
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
}

// Tap the map at offsets (px) from its centre
async function tapMap(page, dx, dy) {
  const box = await page.locator('#map').boundingBox();
  await page.locator('#map').click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
}

async function drawRect(page, w = 160, h = 80) {
  await page.locator('#btn-draw').click();
  for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) await tapMap(page, x, y);
  await page.locator('#btn-finish').click();
  await expect(page.locator('#roof-result')).toBeVisible();
  await nextFrame(page);
}

test('@smoke location tab shows the satellite map and climate for Baghdad', async ({ page }) => {
  const errors = await load(page);
  await openMap(page);
  await expect(page.locator('#clim-src')).toHaveText('NASA POWER (built-in)');
  expect(await num(page.locator('#cl-ghi'))).toBeGreaterThan(1800);
  await expect(page.locator('#gmaps')).toHaveAttribute('href', /google\.com\/maps\/@33\.31/);
  await expect(page.locator('#cl1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('city presets change the result: Basra produces more than Zakho', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  await page.locator('#in-city').selectOption({ label: 'Zakho' });
  await nextFrame(page);
  const zakho = await num(metric(page, 'annual'));
  await page.locator('#in-city').selectOption({ label: 'Basra' });
  await nextFrame(page);
  expect(await num(metric(page, 'annual'))).toBeGreaterThan(zakho * 1.05);
  await expect(page.locator('#subtitle')).toContainText('Basra');
  await expect(page).toHaveURL(/lat=30\.5/);
});

test('search finds a place and moves the model there', async ({ page }) => {
  await load(page);
  await openMap(page);
  await page.locator('#loc-q').fill('Erbil');
  await page.locator('#loc-search button[type=submit]').click();
  await page.locator('#loc-results button', { hasText: 'Erbil' }).click();
  await expect(page.locator('#v-latlon')).toHaveText('36.191°, 44.009°');
  await expect(page.locator('#subtitle')).toContainText('Erbil');       // within 3 km → built-in city data
  expect(page.__calls.search).toBeGreaterThan(0);
});

test('a custom location fetches NASA POWER climate live', async ({ page }) => {
  await load(page, '#lat=34.2&lon=41.6');                              // western desert, far from any built-in city
  await expect(page.locator('#clim-src')).toHaveText('NASA POWER (live)');
  expect(page.__calls.power).toBe(1);
  await openMap(page);
  expect(await num(page.locator('#cl-ghi'))).toBe(2190);                // fixture: 6 kWh/m²/day × 365
});

test('if NASA POWER is unreachable the nearest city is used, without errors', async ({ page }) => {
  const errors = await load(page, '#lat=34.2&lon=41.6', { powerFail: true });
  await expect(page.locator('#clim-src')).toContainText(/approx.*using Rutba data \(\d+ km away\); NASA POWER unavailable/);
  await expect(metric(page, 'annual')).not.toHaveText('—');
  expect(errors.filter(e => !/net::ERR_FAILED|Failed to load resource/.test(e))).toEqual([]);
});

test('tapping the map sets a custom location', async ({ page }) => {
  await load(page);
  await openMap(page);
  const before = await page.locator('#v-latlon').textContent();
  await tapMap(page, 120, -60);
  await expect(page.locator('#v-latlon')).not.toHaveText(before);
  await expect(page).toHaveURL(/lat=/);
});

test('@smoke drawing a roof measures it and applies area + orientation', async ({ page }) => {
  const errors = await load(page);
  await openMap(page);
  await drawRect(page);
  const area = await num(page.locator('#rr-area'));
  expect(area).toBeGreaterThan(500);                                    // ~160×80 px at zoom 17
  expect(Math.abs(Number(await page.locator('#num-area').inputValue()) - area)).toBeLessThan(1); // applied to model
  await expect(page.locator('#rr-facing')).toContainText('S · 180°');   // flat roof → racks face south
  await expect(page.locator('#rr-edge')).toContainText('E–W');
  expect(errors).toEqual([]);
});

test('pitched roof: sloped area > plan area, and the panels can face the other side', async ({ page }) => {
  await load(page);
  await openMap(page);
  await drawRect(page);
  const plan = await num(page.locator('#rr-plan'));
  await page.locator('input[name="rooftype"][value="pitched"]').check();
  await nextFrame(page);
  const sloped = await num(page.locator('#rr-area'));
  expect(sloped / plan).toBeCloseTo(1 / Math.cos(15 * Math.PI / 180), 2); // default tilt 15°
  await expect(page.locator('#rr-facing')).toHaveText('S · 180°');
  await page.locator('#btn-flip').click();
  await expect(page.locator('#rr-facing')).toHaveText('N · 0°');
  await expect(page.locator('#in-orient')).toHaveValue('180');
});

test('undo and clear while drawing', async ({ page }) => {
  await load(page);
  await openMap(page);
  await page.locator('#btn-draw').click();
  await expect(page.locator('#btn-finish')).toBeDisabled();
  await tapMap(page, -50, -50); await tapMap(page, 50, -50); await tapMap(page, 50, 50);
  await expect(page.locator('#btn-finish')).toBeEnabled();
  await page.locator('#btn-undo').click();
  await expect(page.locator('#btn-finish')).toBeDisabled();
  await expect(page.locator('.vtx')).toHaveCount(2);
  await page.locator('#btn-clear').click();
  await expect(page.locator('.vtx')).toHaveCount(0);
});

test('house mode switches inputs, load profile and defaults', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  await expect(page.locator('#in-load')).toBeVisible();
  await expect(page.locator('#num-houseKwh')).toBeHidden();
  await page.locator('#in-building').selectOption('house');
  await nextFrame(page);
  await expect(page.locator('#num-houseKwh')).toBeVisible();
  await expect(page.locator('#in-load')).toBeHidden();
  await expect(page.locator('#in-shift')).toBeHidden();
  await expect(page.locator('#num-area')).toHaveValue('150');
  const kwp = await num(metric(page, 'kwp'));
  expect(kwp).toBeGreaterThan(5);
  expect(kwp).toBeLessThan(15);
  await expect(page).toHaveURL(/building=house/);
  await closeInputs(page, testInfo);
  await expect(page.locator('#subtitle')).toContainText('House');
});

test('a shared link restores location, building and roof inputs', async ({ page }) => {
  await load(page, '#building=house&lat=36.191&lon=44.009&area=96.5&orient=-30');
  await expect(page.locator('#subtitle')).toContainText('Erbil');
  await expect(page.locator('#num-area')).toHaveValue('96.5');
  await expect(page.locator('#v-orient')).toHaveText('SSE · 150°');
  expect(page.__calls.power).toBe(0);                                   // built-in city: no network needed
});

test('map and drawing tools fit on a phone screen', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), 'mobile only');
  await load(page);
  await openMap(page);
  const box = await page.locator('#map').boundingBox();
  const vw = page.viewportSize().width;
  expect(box.width).toBeGreaterThan(vw - 60);
  expect(box.height).toBeGreaterThan(280);
  for (const b of await page.locator('.map-tools .btn').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(36);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
