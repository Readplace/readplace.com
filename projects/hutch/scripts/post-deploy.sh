#!/bin/bash
set -euo pipefail

STACK="${PULUMI_STACK:?PULUMI_STACK is not set}"

# Default curl/* UA is rejected by src/runtime/web/middleware/naive-bot.ts.
USER_AGENT="Readplace-Deploy-Verify/1.0"

RAW_URL=$(pulumi stack output apiUrl --stack "$STACK")
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

verify ""
verify "/embed"
verify "/embed/icon.svg"

if [ "$STACK" = "staging" ]; then
  npx playwright install --with-deps chromium
  STAGING_URL="$URL" pnpm test:e2e:staging
else
  echo "No post-deploy E2E tests for $STACK — skipping"
fi
