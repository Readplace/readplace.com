const assert = require('node:assert');
assert(process.env.E2E_PORT, 'E2E_PORT is required');
const port = process.env.E2E_PORT;

module.exports = {
  projectName: 'Web Embed',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      timeout: 10000,
    },
    {
      type: 'playwright',
      name: 'Running E2E tests',
      config: 'playwright.config.local-dev.ts',
      browsers: ['chromium'],
      env: { HEADLESS: 'true', E2E_PORT: port },
      e2e: true,
    },
  ],
};
