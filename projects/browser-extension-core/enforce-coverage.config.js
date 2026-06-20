const baseConfig = require('../../enforce-coverage.config.base');
const path = require('path')

const config = {
  ...baseConfig,
  thresholds: {
    statements: 100,
    branches: 100,
    functions: 100,
    lines: 100,
  },
  extraExcludePatterns: [
    // E2E action creators — exercised by extension E2E tests, not unit-testable
    'src/e2e-actions/**',
  ],
};

config.enforceCoverage({
  projectRoot: path.resolve(__dirname),
  thresholds: config.thresholds,
  showTextTable: true,
  extraExcludePatterns: config.extraExcludePatterns,
})
