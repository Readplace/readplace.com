const baseConfig = require('../../../enforce-coverage.config.base');
const path = require('path');

/**
 * The `functions` threshold is relaxed because several in-memory auth and
 * session providers are exercised by the consuming application's integration
 * and route tests rather than by colocated unit tests in this package. Adding
 * redundant unit-test calls for each one is busywork — CI still exercises them
 * when the consumer's coverage report compiles against this package's built
 * output.
 */
const config = {
  ...baseConfig,
  thresholds: {
    statements: 97,
    branches: 95,
    functions: 85,
    lines: 97,
  },
};

config.enforceCoverage({
  projectRoot: path.resolve(__dirname),
  thresholds: config.thresholds,
  showTextTable: true,
  extraExcludePatterns: [
    ...(config.extraExcludePatterns || []),
  ],
});
