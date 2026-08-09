#!/usr/bin/env node
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { getFreePort } = require('@packages/test-phase-runner');
const {
  samplesPerCondition,
  warmupsPerCondition,
} = require('../perf-article-open.config.js');

// Deliberately not a test-phase-runner phase: `e2e: true` phases are retried
// once on failure and skipped entirely under CLAUDE_CODE_REMOTE, either of
// which would let a measurement run report green without measuring anything.
async function main() {
  const label = process.env.PERF_ARTICLE_OPEN_LABEL;
  assert(
    label,
    'PERF_ARTICLE_OPEN_LABEL is required: it names the report this run writes ' +
      '(for example `baseline` or `boosted`), so two runs of the same harness ' +
      'against two different server builds do not overwrite each other.'
  );

  const result = spawnSync(
    'node',
    [
      '--test',
      '--test-timeout=3600000',
      'dist/e2e/article-open-perf/run.perf-local.main.js',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_PORT: String(await getFreePort()),
        PERF_ARTICLE_OPEN_SAMPLES: String(samplesPerCondition),
        PERF_ARTICLE_OPEN_WARMUPS: String(warmupsPerCondition),
      },
    }
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error('Article-open perf run failed:', error.message);
  process.exit(1);
});
