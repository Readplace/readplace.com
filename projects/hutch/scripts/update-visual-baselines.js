#!/usr/bin/env node
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { globSync } = require('node:fs');
const path = require('node:path');
const { getFreePort } = require('@packages/test-phase-runner');
const { HutchLogger, consoleLogger } = require('@packages/hutch-logger');
const { devDependencies } = require('../package.json');

const logger = HutchLogger.from(consoleLogger);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..', '..');
const PLAYWRIGHT_CONFIG = 'playwright.config.local-dev.ts';
const VISUAL_SPEC_PATTERNS = [
  'src/e2e/**/*-visual.e2e-local.ts',
  'src/e2e/queue-flow/run.e2e-local.ts',
];

function playwrightImage() {
  const pinnedVersion = devDependencies['@playwright/test'];
  assert.match(
    pinnedVersion,
    /^\d+\.\d+\.\d+$/,
    `@playwright/test must be pinned to an exact version so the container matches the host renderer, got "${pinnedVersion}"`,
  );
  return `mcr.microsoft.com/playwright:v${pinnedVersion}-noble`;
}

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
    run('docker', ['pull', '--platform', 'linux/amd64', image]);
  } catch (cause) {
    throw new Error(
      `Cannot reach Docker to pull ${image}, which is the only place the -chromium-linux baselines can be captured. Refusing to refresh darwin alone and leave the two platforms out of step — start Docker (see devbox.json) and re-run.`,
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
    '--update-snapshots=changed',
    ...specs,
  ];
}

async function captureDarwinBaselines(specs) {
  process.env.E2E_PORT = String(await getFreePort());
  process.env.HEADLESS = 'true';
  run('node_modules/.bin/playwright', ['install', 'chromium']);
  const [command, ...args] = playwrightCommand(specs);
  run(command, args);
}

async function captureLinuxBaselines(specs, image) {
  const port = await getFreePort();
  const insideContainer = [
    `cd "${WORKSPACE_ROOT}"`,
    '. ./.envrc',
    `cd "${PROJECT_ROOT}"`,
    `exec ${playwrightCommand(specs).join(' ')}`,
  ].join(' && ');
  run('docker', [
    'run',
    '--rm',
    '--ipc=host',
    '--platform',
    'linux/amd64',
    '--volume',
    `${WORKSPACE_ROOT}:${WORKSPACE_ROOT}`,
    '--workdir',
    PROJECT_ROOT,
    '--env',
    'HEADLESS=true',
    '--env',
    `E2E_PORT=${port}`,
    image,
    'bash',
    '-c',
    insideContainer,
  ]);
}

function reportBaselines(specs) {
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--', ...specs.map((spec) => `${spec}-snapshots`)],
    { cwd: PROJECT_ROOT, encoding: 'utf8' },
  ).trim();
  if (status) {
    logger.info(`\nBaselines changed — commit every platform together:\n${status}\n`);
    return;
  }
  logger.info('\nBaselines are byte-identical to the committed ones.\n');
}

async function main() {
  assert.equal(
    process.platform,
    'darwin',
    'the -chromium-darwin baselines can only be captured on macOS; on any other host this run would refresh linux alone and leave darwin stale',
  );

  const specs = visualSpecs();
  const image = playwrightImage();
  logger.info(`\n=== Readplace - Regenerating visual baselines for ${specs.join(', ')} ===\n`);

  pullPlaywrightImage(image);

  logger.info('\n=== Readplace - Capturing chromium-darwin baselines ===\n');
  await captureDarwinBaselines(specs);

  logger.info(`\n=== Readplace - Capturing chromium-linux baselines in ${image} ===\n`);
  await captureLinuxBaselines(specs, image);

  reportBaselines(specs);
}

main().catch((error) => {
  logger.error('Visual baseline regeneration failed:', error);
  process.exit(1);
});
