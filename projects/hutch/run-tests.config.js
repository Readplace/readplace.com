const assert = require('node:assert');
const os = require('node:os');
assert(process.env.E2E_PORT, 'E2E_PORT is required');
const port = process.env.E2E_PORT;

// Shard count mirrors the NX_PARALLEL governor in .envrc so the two size their
// pools the same way. A host with fewer than 16 cores runs the suite in one
// worker (shards = 1) — sharding there would only oversubscribe the box against
// nx's own project-level parallelism, which nx already keeps serial on small
// hosts — while a 16+ core host shards to 80% of its cores (floored), leaving the
// same ~20% headroom nx leaves for the OS and the sibling projects it schedules
// alongside this one. The unit suite is the long pole of `check` (~240 files jest
// pins to one core under coverage), so on a big host this is where the reclaimed
// cores pay off; the shards' V8 profiles share the c8 coverage dir and merge into
// the identical numbers a single run produces.
const cores = os.availableParallelism();
const jestShards = cores >= 16 ? Math.floor((cores * 80) / 100) : 1;

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
    },
  ],
};
