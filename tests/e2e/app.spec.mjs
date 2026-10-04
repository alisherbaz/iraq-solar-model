// End-to-end tests — run on desktop and mobile viewports (see playwright.config.mjs).
// Tests tagged @smoke are safe to run against the live Netlify site after each deploy.
import { test, expect } from '@playwright/test';

const isMobile = testInfo => testInfo.project.name !== 'desktop';

async function load(page, hash = '') {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./' + hash); // relative, so it works when the site is served from a sub-path (GitHub Pages)
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  return errors;
}

async function openInputs(page, testInfo) {
  if (isMobile(testInfo)) {
    await page.locator('#btn-open-controls').click();
    await expect(page.locator('#controls')).toHaveClass(/open/);
  }
}

async function setInput(page, key, value) {
  await page.locator('#in-' + key).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, String(value));
  await page.waitForFunction(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
}

const metric = (page, k) => page.locator(`[data-m="${k}"]`);
const num = async loc => Number((await loc.textContent()).replace(/[^0-9.\-]/g, ''));

test('@smoke loads without errors and fills every metric', async ({ page }) => {
  const errors = await load(page);
  for (const k of ['daily', 'peak', 'kwp', 'annual', 'savings', 'co2', 'panels', 'sf', 'export', 'payback']) {
    await expect(metric(page, k)).not.toHaveText('—');
  }
  expect(await num(metric(page, 'kwp'))).toBe(700);
  expect(errors).toEqual([]);
});

test('@smoke every tab shows its panel with rendered charts', async ({ page }) => {
  await load(page);
  for (const name of ['generation', 'battery', 'optimisation', 'grants', 'method']) {
    await page.locator(`.tab[data-tab="${name}"]`).click();
    const panel = page.locator('#tab-' + name);
    await expect(panel).toBeVisible();
    await expect(page.locator(`.tab[data-tab="${name}"]`)).toHaveAttribute('aria-selected', 'true');
    for (const canvas of await panel.locator('canvas').all()) {
      const box = await canvas.boundingBox();
      expect(box.width, `canvas in ${name}`).toBeGreaterThan(100);
      expect(box.height).toBeGreaterThan(100);
    }
  }
});

test('heat map has 365 day cells and the roof diagram renders', async ({ page }) => {
  await load(page);
  await expect(page.locator('#heatmap .cell')).toHaveCount(365);
  expect(await page.locator('#rsvg rect').count()).toBeGreaterThan(50);
});

test('changing panel area updates capacity and annual output', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  const before = await num(metric(page, 'annual'));
  await setInput(page, 'area', 10000);
  await expect(page.locator('#num-area')).toHaveValue('10000');
  expect(await num(metric(page, 'kwp'))).toBe(1400);
  expect(await num(metric(page, 'annual'))).toBeCloseTo(before * 2, -1);
});

test('a 10 m² roof can be typed in and shows decimals, not "1 kWp"', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  const box = page.locator('#num-area');
  await box.fill('10');
  await box.blur();
  await expect(page.locator('#in-area')).toHaveValue('10');
  await expect(metric(page, 'kwp')).toHaveText('1.4');
  await expect(metric(page, 'panels')).toHaveText('4');
  expect(await num(metric(page, 'annual'))).toBeGreaterThan(1);
  // Below the minimum is clamped back to 10 when the box loses focus
  await box.fill('3');
  await box.blur();
  await expect(box).toHaveValue('10');
});

test('diesel share and EU grant toggle shorten payback', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  const base = await num(metric(page, 'payback'));
  await setInput(page, 'dieselShare', 50);
  const diesel = await num(metric(page, 'payback'));
  expect(diesel).toBeLessThan(base);
  await page.locator('#in-euOn').check();
  await page.waitForFunction(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
  expect(await num(metric(page, 'payback'))).toBeLessThan(diesel);
  await expect(page).toHaveURL(/euOn=1/);
});

test('south-facing panels beat north-facing (orientation regression)', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  await setInput(page, 'pitch', 30);
  const south = await num(metric(page, 'annual'));
  await setInput(page, 'orient', 180);
  const north = await num(metric(page, 'annual'));
  expect(south).toBeGreaterThan(north * 1.15);
});

test('weather only changes the selected day, not annual totals', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  const annual = await num(metric(page, 'annual'));
  const daily = await num(metric(page, 'daily'));
  await setInput(page, 'wx', 'dusty');
  expect(await num(metric(page, 'daily'))).toBeLessThan(daily);
  expect(await num(metric(page, 'annual'))).toBe(annual);
});

test('grants reduce payback', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  const before = await num(metric(page, 'payback'));
  await setInput(page, 'grant', 40);
  expect(await num(metric(page, 'payback'))).toBeLessThan(before);
});

test('scenario is saved to the URL and restored on reload', async ({ page }, testInfo) => {
  await load(page);
  await openInputs(page, testInfo);
  await setInput(page, 'pitch', 32);
  await setInput(page, 'batt', 1500);
  await expect(page).toHaveURL(/#.*pitch=32/);
  const annual = await metric(page, 'annual').textContent();
  await page.reload();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('#in-pitch')).toHaveValue('32');
  await expect(page.locator('#in-batt')).toHaveValue('1500');
  await expect(metric(page, 'annual')).toHaveText(annual);
});

test('malicious / out-of-range URL state is sanitised', async ({ page }) => {
  const errors = await load(page, '#pitch=999&wx=<img src=x onerror=alert(1)>&area=abc');
  await expect(page.locator('#in-pitch')).toHaveValue('45');
  await expect(page.locator('#in-wx')).toHaveValue('average');
  expect(errors).toEqual([]);
});

test('reset restores defaults', async ({ page }, testInfo) => {
  await load(page, '#pitch=40&area=20000');
  await page.locator('#btn-reset').click();
  await expect(page.locator('#in-pitch')).toHaveValue('15');
  await expect(page.locator('#in-area')).toHaveValue('5000');
  expect(await num(metric(page, 'kwp'))).toBe(700);
  await expect(page).not.toHaveURL(/#./);
});

test('CSV export downloads monthly results', async ({ page }) => {
  await load(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-csv').click()]);
  expect(dl.suggestedFilename()).toBe('iraq-solar-model.csv');
  const body = await (await dl.createReadStream()).toArray();
  const csv = Buffer.concat(body).toString();
  expect(csv).toMatch(/^Month,Generation kWh/);
  expect(csv).toContain('Dec,');
});

test('@smoke no horizontal page overflow on any tab', async ({ page }) => {
  await load(page);
  for (const name of ['generation', 'battery', 'optimisation', 'grants', 'method']) {
    await page.locator(`.tab[data-tab="${name}"]`).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${name}`).toBeLessThanOrEqual(0);
  }
});

test.describe('mobile layout', () => {
  test.beforeEach(async ({}, testInfo) => test.skip(!isMobile(testInfo), 'mobile only'));

  test('@smoke inputs live in a bottom sheet opened by the floating button', async ({ page }) => {
    await load(page);
    const sheet = page.locator('#controls');
    await expect(page.locator('#btn-open-controls')).toBeVisible();
    // Closed: sheet is off-screen
    expect((await sheet.boundingBox()).y).toBeGreaterThanOrEqual(page.viewportSize().height - 1);
    await page.locator('#btn-open-controls').click();
    await expect(sheet).toHaveClass(/open/);
    await expect(page.locator('#in-doy')).toBeInViewport();
    // Sheet scrolls internally to reach the last input
    await page.locator('#in-loan').scrollIntoViewIfNeeded();
    await expect(page.locator('#in-loan')).toBeInViewport();
    await page.locator('#btn-close-controls').click();
    await expect(sheet).not.toHaveClass(/open/);
    await expect(page.locator('#backdrop')).toBeHidden();
  });

  test('backdrop tap closes the sheet', async ({ page }) => {
    await load(page);
    await page.locator('#btn-open-controls').click();
    await page.mouse.click(page.viewportSize().width / 2, 20);
    await expect(page.locator('#controls')).not.toHaveClass(/open/);
  });

  test('metrics are in a 2-column grid and the last tab is reachable', async ({ page }) => {
    await load(page);
    const cols = await page.locator('#metrics').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    await page.locator('.tab[data-tab="method"]').click();
    await expect(page.locator('#tab-method')).toBeVisible();
  });

  test('tap targets for buttons are at least 32px tall', async ({ page }) => {
    await load(page);
    for (const b of await page.locator('.actions .btn, .tab, #btn-open-controls').all()) {
      if (!(await b.isVisible())) continue;
      expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(32);
    }
  });
});

test.describe('desktop layout', () => {
  test.beforeEach(async ({}, testInfo) => test.skip(isMobile(testInfo), 'desktop only'));

  test('controls sidebar is visible and the floating button is hidden', async ({ page }) => {
    await load(page);
    await expect(page.locator('#in-area')).toBeVisible();
    await expect(page.locator('#btn-open-controls')).toBeHidden();
  });

  test('tabs support arrow-key navigation', async ({ page }) => {
    await load(page);
    await page.locator('.tab[data-tab="generation"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-battery')).toBeVisible();
    await expect(page.locator('.tab[data-tab="battery"]')).toBeFocused();
  });
});
