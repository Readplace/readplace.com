#!/bin/bash
set -euo pipefail

STACK="${PULUMI_STACK:?PULUMI_STACK is not set}"

USER_AGENT="Readplace-Deploy-Verify/1.0"

phase_name=""
phase_started_at=0

start_phase() {
  phase_name="$1"
  phase_started_at=$(date -u +%s)
  echo "==> $phase_name"
}

finish_phase() {
  echo "<== $phase_name finished in $(( $(date -u +%s) - phase_started_at ))s"
}

start_phase "reading apiUrl from the $STACK pulumi stack"
RAW_URL=$(pulumi stack output apiUrl --stack "$STACK")
finish_phase
# Strip /$default suffix that API Gateway appends to the URL
URL="${RAW_URL%/\$default}"
echo "Verifying $STACK deployment at: $URL"

verify() {
  local path="$1"
  local attempt
  for attempt in 1 2 3; do
    if curl --fail --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --output /dev/null "$URL$path"; then
      return 0
    fi
    echo "Attempt $attempt failed for $URL$path — retrying in 5s"
    sleep 5
  done
  echo "--- Diagnostic dump for $URL$path ---"
  curl --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --dump-header - "$URL$path" | head -20
  return 1
}

start_phase "checking /, /embed and /embed/icon.svg respond"
verify ""
verify "/embed"
verify "/embed/icon.svg"
finish_phase

if [ "$STACK" = "staging" ]; then
  start_phase "installing chromium and its apt system dependencies"
  npx playwright install --with-deps chromium
  finish_phase
  start_phase "running the staging E2E suite"
  STAGING_URL="$URL" pnpm test:e2e:staging
  finish_phase
  start_phase "measuring screen-response latency against staging"
  STAGING_URL="$URL" PERF_SCREEN_RESPONSE_SHA="$(git rev-parse HEAD)" pnpm perf-screen-response
  finish_phase
else
  echo "No post-deploy E2E tests for $STACK — skipping"
fi
