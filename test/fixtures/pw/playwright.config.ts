import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  retries: 1,
  reporter: 'list',
  projects: [{ name: 'chromium' }, { name: 'api' }],
});
