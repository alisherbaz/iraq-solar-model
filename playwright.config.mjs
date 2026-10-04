import { defineConfig, devices } from '@playwright/test';

// BASE_URL lets the same suite run against a deployed site, e.g.
//   BASE_URL=https://your-site.netlify.app npm run test:e2e
const BASE_URL = process.env.BASE_URL && process.env.BASE_URL.replace(/\/?$/, '/');
const PORT = 5180;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL || `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'small-phone', use: { ...devices['Galaxy S9+'], viewport: { width: 320, height: 640 } } },
  ],
  webServer: BASE_URL ? undefined : {
    command: `node scripts/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
