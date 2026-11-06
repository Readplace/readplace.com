/** @type {import('jest').Config} */
module.exports = {
  ...(process.env.NODE_V8_COVERAGE ? { maxWorkers: 1 } : {}),
};
