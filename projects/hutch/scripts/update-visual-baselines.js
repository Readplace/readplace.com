#!/usr/bin/env node
const path = require('node:path');
const { defaultUpdateVisualBaselinesDeps, initUpdateVisualBaselines } = require('@packages/test-phase-runner');
const { Logger, consoleLogger } = require('@packages/logger');
const { devDependencies } = require('../package.json');

const logger = Logger.from(consoleLogger);
const projectRoot = path.resolve(__dirname, '..');

initUpdateVisualBaselines({ ...defaultUpdateVisualBaselinesDeps, log: (message) => logger.info(message) })({
  projectRoot,
  workspaceRoot: path.resolve(projectRoot, '..', '..'),
  projectLabel: 'Readplace',
  specPatterns: [
    'src/e2e/**/*-visual.e2e-local.ts',
    'src/e2e/readlist-flow/run.e2e-local.ts',
  ],
  playwrightVersion: devDependencies['@playwright/test'],
  argvSpecs: process.argv.slice(2),
}).catch((error) => {
  logger.error('Visual baseline regeneration failed:', error);
  process.exit(1);
});
