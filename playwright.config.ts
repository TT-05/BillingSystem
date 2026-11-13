import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  projects: [
    {
      name: 'desktop-chrome',
      testIgnore: '**/mobile.spec.ts',
      use: { channel: process.platform === 'darwin' ? 'chrome' : undefined },
    },
    {
      name: 'mobile-chromium',
      testMatch: '**/mobile.spec.ts',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        channel: process.platform === 'darwin' ? 'chrome' : undefined,
      },
    },
    {
      name: 'mobile-webkit',
      testMatch: '**/mobile.spec.ts',
      use: { ...devices['iPhone 13'], browserName: 'webkit', channel: undefined },
    },
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 12000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    env: { VITE_USE_EMULATORS: 'true' },
    timeout: 30000,
  },
});
