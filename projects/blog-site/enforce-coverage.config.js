const baseConfig = require('../../enforce-coverage.config.base');
const path = require('path');

const config = {
  ...baseConfig,
  thresholds: {
    statements: 100,
    branches: 100,
    functions: 100,
    lines: 100,
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
});
