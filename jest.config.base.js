const path = require('node:path');

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
  // Worker policy for coverage runs (c8 exports NODE_V8_COVERAGE). A jest worker
  // force-exited before flushing its V8 coverage shard drops coverage below
  // threshold even though every test passes — local macOS socket/inspector
  // teardown lags enough to trigger this. CI runs on Linux where workers flush
  // cleanly, so it keeps the proven 2-worker pool; everywhere else coverage runs
  // in-band so no shard is lost. A plain `jest` run (no coverage) keeps its pool.
  ...(process.env.NODE_V8_COVERAGE ? { maxWorkers: process.env.CI === 'true' ? 2 : 1 } : {}),
  // jest.retryTimes lives in this setup file. Attaching here so every
  // project picks it up without each having to reference it explicitly.
  setupFilesAfterEnv: [path.resolve(__dirname, 'jest.setup.base.js')],
};
