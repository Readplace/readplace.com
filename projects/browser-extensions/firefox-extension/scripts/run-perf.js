#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { getFreePort } = require('@packages/test-phase-runner');

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
  const port = String(await getFreePort());

  run('node', ['scripts/build-extension.js'], {
    HUTCH_SERVER_URL: `http://127.0.0.1:${port}`,
  });
  run('node', ['--test', '--test-timeout=300000', 'dist/e2e/save-perf-flow/run.perf-local.main.js'], {
    E2E_PORT: port,
  });
}

main().catch((error) => {
  console.error('Perf run failed:', error.message);
  process.exit(1);
});
