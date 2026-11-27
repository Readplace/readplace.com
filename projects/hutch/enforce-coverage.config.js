const baseConfig = require('../../enforce-coverage.config.base');
const path = require('path')
const { getEnv } = require('@packages/require-env')

const e2ePhasesSkipped = getEnv('CLAUDE_CODE_REMOTE') === 'true'
const coveredInFullOnlyByDynamoDbLocalPhase = [
  'src/runtime/bulk-articles/dynamo-execution.ts',
  'src/runtime/bulk-articles/dynamo-preparation.ts',
  'src/runtime/bulk-articles/selection-store.ts',
  'src/runtime/media-release/bulk-upload-retention.ts',
]

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
    ...(e2ePhasesSkipped ? coveredInFullOnlyByDynamoDbLocalPhase : []),
  ],
})
