const baseConfig = require('../../enforce-coverage.config.base');
const path = require('path')

const config = {
  ...baseConfig,
  thresholds: {
    statements: 99,
    branches: 96,
    functions: 100,
    lines: 99,
  },
};

config.enforceCoverage({
  projectRoot: path.resolve(__dirname),
  thresholds: config.thresholds,
  showTextTable: true,
  extraExcludePatterns: [
    ...(config.extraExcludePatterns || []),
    // Infrastructure layer — deployed via Pulumi, not testable in CI
    'src/infra/**',
  ],
})
