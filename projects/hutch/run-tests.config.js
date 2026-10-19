const assert = require('node:assert');
const os = require('node:os');
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

const cores = os.availableParallelism();
const jestShards = Math.max(1, Math.floor((cores * 80) / 100));

module.exports = {
  projectName: 'Readplace',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      timeout: 10000,
      shards: jestShards,
    },
    {
      type: 'jest',
      name: 'Running integration tests',
      testMatch: '**/dist/**/*.integration.js',
      timeout: 30000,
      passWithNoTests: true,
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
