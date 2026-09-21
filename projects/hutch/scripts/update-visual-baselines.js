#!/usr/bin/env node
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { globSync } = require('node:fs');
const path = require('node:path');
const {
  containerisedCommand,
  defaultDeps,
  getFreePort,
  playwrightImage,
} = require('@packages/test-phase-runner');
const { HutchLogger, consoleLogger } = require('@packages/hutch-logger');
const { devDependencies } = require('../package.json');

const logger = HutchLogger.from(consoleLogger);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..', '..');
const PLAYWRIGHT_CONFIG = 'playwright.config.local-dev.ts';
const VISUAL_SPEC_PATTERNS = [
  'src/e2e/**/*-visual.e2e-local.ts',
  'src/e2e/readlist-flow/run.e2e-local.ts',
];

function visualSpecs() {
  return VISUAL_SPEC_PATTERNS.flatMap((pattern) => {
    const matches = globSync(pattern, { cwd: PROJECT_ROOT });
    assert.ok(matches.length > 0, `no visual specs matched ${pattern}`);
    return matches;
  }).sort();
}

function run(command, args, options) {
  execFileSync(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', ...options });
}

function pullPlaywrightImage(image) {
  try {
    run('docker', ['pull', image]);
  } catch (cause) {
    throw new Error(
      `Cannot reach Docker to pull ${image}, which is the renderer the baselines are captured and verified in. Start Docker (see devbox.json) and re-run.`,
      { cause },
    );
  }
}

function playwrightCommand(specs) {
  return [
    'node_modules/.bin/playwright',
    'test',
    '--config',
    PLAYWRIGHT_CONFIG,
    '--update-snapshots=all',
    ...specs,
  ].join(' ');
}

async function captureBaselines(specs, image) {
  const port = await getFreePort();
  const renderer = {
    image,
    workspaceRoot: WORKSPACE_ROOT,
    forwardEnv: ['HEADLESS', 'E2E_PORT'],
  };
  const env = { ...process.env, HEADLESS: 'true', E2E_PORT: String(port) };

  if (defaultDeps.rendersNatively()) {
    run('node_modules/.bin/playwright', ['install', 'chromium'], { env });
    run('bash', ['-c', playwrightCommand(specs)], { env });
    return;
  }

  pullPlaywrightImage(image);
  run('bash', ['-c', containerisedCommand(playwrightCommand(specs), renderer, PROJECT_ROOT)], {
    env,
  });
}

function reportBaselines(specs) {
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--', ...specs.map((spec) => `${spec}-snapshots`)],
    { cwd: PROJECT_ROOT, encoding: 'utf8' },
  ).trim();
  if (status) {
    logger.info(`\nBaselines changed — review the diff before committing:\n${status}\n`);
    return;
  }
  logger.info('\nBaselines are byte-identical to the committed ones.\n');
}

async function main() {
  const specs = visualSpecs();
  const image = playwrightImage(devDependencies['@playwright/test']);
  logger.info(`\n=== Readplace - Regenerating visual baselines for ${specs.join(', ')} ===\n`);

  await captureBaselines(specs, image);

  reportBaselines(specs);
}

main().catch((error) => {
  logger.error('Visual baseline regeneration failed:', error);
  process.exit(1);
});
