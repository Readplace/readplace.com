const baseConfig = require('../../../jest.config.base');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/', '/dist/e2e/'],
};
