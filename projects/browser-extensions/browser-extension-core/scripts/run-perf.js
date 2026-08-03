#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const {
  meanSaveMs,
  roundTripMs,
  samplesPerScenario,
  meanSaveAllMs,
  tabsPerSaveAll,
} = require('../perf.config.js');

// Deliberately not a test-phase-runner phase: `e2e: true` phases are retried
// once on failure and skipped entirely under CLAUDE_CODE_REMOTE, either of
// which would let a breached latency budget report green.
const result = spawnSync('node', ['--test', 'dist/perf/run.perf.main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PERF_MEAN_SAVE_BUDGET_MS: String(meanSaveMs),
    PERF_ROUND_TRIP_MS: String(roundTripMs),
    PERF_SAMPLES_PER_SCENARIO: String(samplesPerScenario),
    PERF_MEAN_SAVE_ALL_BUDGET_MS: String(meanSaveAllMs),
    PERF_TABS_PER_SAVE_ALL: String(tabsPerSaveAll),
  },
});

process.exit(result.status ?? 1);
