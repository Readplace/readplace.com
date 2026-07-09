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
  // Worker policy. Coverage runs (c8 exports NODE_V8_COVERAGE) run IN-BAND: a
  // jest worker force-exited before flushing its V8 coverage shard drops
  // coverage below threshold even though every test passes — leaked request
  // handles keep a worker alive past shutdown, jest SIGKILLs it, and whichever
  // suites that worker ran report 0%, a per-run lottery. In-band leaves no
  // worker to kill; the process exit flushes coverage via V8's exit hooks where
  // SIGKILL cannot. Parallelism is recovered at the nx level — NX_PARALLEL (80%
  // of cores on 16+ machines, see .envrc) runs many projects' coverage runs at
  // once, which the 20x-soak gate verifies stays at 100%. Non-coverage runs on
  // 16+ core machines still fan out to half the cores for a fast local `jest`.
  ...(process.env.NODE_V8_COVERAGE
    ? { maxWorkers: 1 }
    : cores >= 16
      ? { maxWorkers: Math.floor(cores * 0.5) }
      : {}),
  // jest.retryTimes lives in this setup file. Attaching here so every
  // project picks it up without each having to reference it explicitly.
  setupFilesAfterEnv: [path.resolve(__dirname, 'jest.setup.base.js')],
};
