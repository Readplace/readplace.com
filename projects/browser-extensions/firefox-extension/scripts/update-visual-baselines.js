#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { globSync } = require('node:fs');
const path = require('node:path');
const { HutchLogger, consoleLogger } = require('@packages/hutch-logger');
const { initVisualBaselines, packagingPath } = require('browser-extension-core/build');
const { devDependencies } = require('../package.json');

const logger = HutchLogger.from(consoleLogger);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..', '..', '..');

// A loopback server URL marks the package as a dev build, which is what lets it
// build without claiming a store version — the popup renders from stubs, so the
// URL baked into the bundle never reaches the captured pixels.
const DEV_SERVER_URL = 'http://127.0.0.1:3000';

const plan = initVisualBaselines({
  run: (command, args, options) =>
    execFileSync(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', ...options }),
  capture: (command, args) =>
    execFileSync(command, args, { cwd: PROJECT_ROOT, encoding: 'utf8' }),
  globSync,
  platform: process.platform,
  log: (message) => logger.info(message),
}).createBaselinePlan({
  projectRoot: PROJECT_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  projectLabel: 'Firefox Extension',
  playwrightConfig: 'playwright.config.local-dev.ts',
  browser: 'firefox',
  specPatterns: ['src/e2e/**/*-visual.e2e-local.ts'],
  playwrightVersion: devDependencies['@playwright/test'],
  buildEnv: {
    ...process.env,
    HUTCH_SERVER_URL: DEV_SERVER_URL,
    PATH: packagingPath({
      projectRoot: PROJECT_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      currentPath: process.env.PATH,
    }),
  },
  captureEnv: { ...process.env, HEADLESS: 'true' },
});

try {
  plan.run();
} catch (error) {
  logger.error('Visual baseline regeneration failed:', error);
  process.exit(1);
}
