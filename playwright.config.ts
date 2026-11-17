import { defineConfig } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3210';
const serverMode = process.env.CI ? 'start' : 'dev';

export default defineConfig({
  testDir: './tests/browser',
  use: {baseURL},
  webServer: {
    command: `npm run ${serverMode} -- --hostname 127.0.0.1 --port 3210`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});
