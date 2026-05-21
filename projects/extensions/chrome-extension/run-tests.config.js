const assert = require('node:assert');
assert(process.env.E2E_PORT, 'E2E_PORT is required');
const port = process.env.E2E_PORT;

module.exports = {
  projectName: 'Chrome Extension',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      testPathIgnorePatterns: 'dist/e2e',
      timeout: 10000,
      passWithNoTests: true,
    },
    {
      type: 'node-test',
      name: 'Running E2E unit tests',
      glob: 'dist/e2e/**/*.test.js',
      e2e: true,
    },
    {
      type: 'script',
      name: 'Building extension for E2E tests',
      command: 'node scripts/build-extension.js',
      env: { HUTCH_SERVER_URL: `http://127.0.0.1:${port}` },
      e2e: true,
    },
    {
      type: 'script',
      name: 'Installing Chrome for Testing',
      command: 'node scripts/install-chrome-for-testing.js',
      e2e: true,
    },
    {
      type: 'node-test',
      name: 'Running E2E tests',
      files: ['dist/e2e/login-flow/run.e2e-local.main.js'],
      timeout: 90000,
      env: { HEADLESS: 'true', E2E_PORT: port },
      e2e: true,
    },
    {
      type: 'node-test',
      name: 'Running PDF save E2E (local, stubbed PDF extractor)',
      files: ['dist/e2e/pdf-save-flow/run.e2e-local.main.js'],
      timeout: 90000,
      env: { E2E_PORT: port },
      e2e: true,
    },
  ],
};
