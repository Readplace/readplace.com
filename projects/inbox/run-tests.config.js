const assert = require('node:assert');
const path = require('node:path');
const { playwrightImage } = require('@packages/test-phase-runner');
const { devDependencies } = require('./package.json');

assert(process.env.E2E_PORT, 'E2E_PORT is required');
const port = process.env.E2E_PORT;

const renderer = {
  image: playwrightImage(devDependencies['@playwright/test']),
  workspaceRoot: path.resolve(__dirname, '..', '..'),
  forwardEnv: ['HEADLESS', 'E2E_PORT', 'NODE_V8_COVERAGE'],
};

module.exports = {
  projectName: 'Inbox',
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
      renderer,
    },
  ],
};
