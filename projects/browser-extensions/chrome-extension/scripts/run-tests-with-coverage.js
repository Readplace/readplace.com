#!/usr/bin/env node
const { join } = require('node:path');
const { initTestPhaseRunner, defaultDeps, getFreePort } = require('@packages/test-phase-runner');

async function main() {
  process.env.E2E_PORT = String(await getFreePort());

  const config = require('../run-tests.config.js');
  const { createTestPlan } = initTestPhaseRunner(defaultDeps);

  const plan = createTestPlan({
    config,
    projectRoot: join(__dirname, '..'),
  });

  await plan.runAllPhases();
}

main().catch((error) => {
  console.error('Test run failed:', error.message);
  process.exit(1);
});
