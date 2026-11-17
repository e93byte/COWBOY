import { defineConfig } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3210';
export default defineConfig({ testDir: './tests/browser', use: { baseURL }, webServer: { command: 'npm run dev -- --port 3210', url: baseURL, reuseExistingServer: true }, reporter: 'list' });
