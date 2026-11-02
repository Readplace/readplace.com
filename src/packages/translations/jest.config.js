// Run the c8 coverage pass IN-BAND. Multi-worker coverage loses a worker's V8
// shard when jest SIGKILLs a leaked-handle worker before it flushes, dropping
// coverage below threshold on a per-run lottery; nx still runs the packages in
// parallel, so cross-package parallelism is preserved. Non-coverage `jest`
// keeps the default pool. Deliberately NOT extended from jest.config.base.js:
// the base's `transform: {}` shifts the V8 block-coverage phantom lines that
// this package's inline `c8 ignore` annotations are calibrated against.
/** @type {import('jest').Config} */
module.exports = {
  ...(process.env.NODE_V8_COVERAGE ? { maxWorkers: 1 } : {}),
};
