// Run the c8 coverage pass IN-BAND. Multi-worker coverage can lose a worker's V8
// shard when jest SIGKILLs a leaked-handle worker before it flushes, dropping
// coverage below threshold on a per-run lottery; nx still runs the packages in
// parallel, so cross-package parallelism is preserved. Non-coverage `jest` keeps
// the default pool.
/** @type {import('jest').Config} */
module.exports = {
  ...(process.env.NODE_V8_COVERAGE ? { maxWorkers: 1 } : {}),
};
