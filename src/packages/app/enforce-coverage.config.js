const baseConfig = require('../../../enforce-coverage.config.base');
const path = require('path');

const config = {
  ...baseConfig,
  thresholds: {
    statements: 98,
    branches: 96,
    functions: 98,
    lines: 98,
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
