#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { getFreePort } = require('@packages/test-phase-runner');
const {
  meanSaveMs,
  gatedSaves,
  warmupSaves,
  meanSaveAllMs,
  tabsPerSaveAll,
  gatedSaveAlls,
  warmupSaveAlls,
} = require('../perf.config.js');

// Deliberately not a test-phase-runner phase: `e2e: true` phases are retried
// once on failure and skipped entirely under CLAUDE_CODE_REMOTE, either of
// which would let a breached latency budget report green.
function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  run('node', ['scripts/install-chrome-for-testing.js'], {});

  const savePort = String(await getFreePort());
  run('node', ['scripts/build-extension.js'], {
    HUTCH_SERVER_URL: `http://127.0.0.1:${savePort}`,
  });
  run('node', ['--test', '--test-timeout=300000', 'dist/e2e/save-perf-flow/run.perf-local.main.js'], {
    E2E_PORT: savePort,
    PERF_MEAN_SAVE_BUDGET_MS: String(meanSaveMs),
    PERF_GATED_SAVES: String(gatedSaves),
    PERF_WARMUP_SAVES: String(warmupSaves),
  });

  // A second server on its own port, not the one the suite above just released:
  // teardown returns once the child is signalled, so reusing that port races a
  // listener that may still hold it. The extension carries the server URL it
  // was built with, so a fresh port means a fresh build.
  const saveAllPort = String(await getFreePort());
  run('node', ['scripts/build-extension.js'], {
    HUTCH_SERVER_URL: `http://127.0.0.1:${saveAllPort}`,
  });
  run('node', ['--test', '--test-timeout=900000', 'dist/e2e/save-all-perf-flow/run.perf-local.main.js'], {
    E2E_PORT: saveAllPort,
    PERF_MEAN_SAVE_ALL_BUDGET_MS: String(meanSaveAllMs),
    PERF_TABS_PER_SAVE_ALL: String(tabsPerSaveAll),
    PERF_GATED_SAVE_ALLS: String(gatedSaveAlls),
    PERF_WARMUP_SAVE_ALLS: String(warmupSaveAlls),
  });
}

main().catch((error) => {
  console.error('Perf run failed:', error.message);
  process.exit(1);
});
