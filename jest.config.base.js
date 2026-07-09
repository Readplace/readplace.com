const os = require('node:os');
const path = require('node:path');

const cores = os.availableParallelism();

// Pre-compile approach: TypeScript is compiled before running tests
// This eliminates V8 coverage artifacts on type definitions
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // No transform needed - TypeScript is pre-compiled
  transform: {},
  moduleFileExtensions: ['js', 'json'],
  rootDir: '.',
  // Suppress captured console.* output in CI to keep logs scannable; keep
  // verbose output locally so debug logs remain visible during dev.
  silent: process.env.CI === 'true',
  // Worker policy. Coverage runs (c8 exports NODE_V8_COVERAGE) historically ran
  // in-band: a jest worker force-exited before flushing its V8 coverage shard
  // drops coverage below threshold even though every test passes — leaked
  // request handles keep a worker alive past shutdown, jest SIGKILLs it, and
  // whichever suites that worker ran report 0%, a per-run lottery. In-band
  // leaves no worker to kill; --forceExit still flushes coverage because
  // process.exit() runs V8's exit hooks where SIGKILL cannot. On 16+ core
  // machines we run half the cores as workers anyway (coverage included) —
  // the lottery needs a leaked handle AND a slow worker shutdown, and the
  // 20x-soak gate on such machines is the tripwire: if suites start reporting
  // 0% with passing tests, restore in-band coverage here and raise NX_PARALLEL
  // to 80% of cores instead. Small machines keep the historical policy.
  ...(cores >= 16
    ? { maxWorkers: Math.floor(cores * 0.5) }
    : process.env.NODE_V8_COVERAGE
      ? { maxWorkers: 1 }
      : {}),
  // jest.retryTimes lives in this setup file. Attaching here so every
  // project picks it up without each having to reference it explicitly.
  setupFilesAfterEnv: [path.resolve(__dirname, 'jest.setup.base.js')],
};
