#!/bin/bash
set -euo pipefail

STACK="${PULUMI_STACK:?PULUMI_STACK is not set}"

USER_AGENT="Readplace-Deploy-Verify/1.0"

RAW_URL=$(pulumi stack output apiUrl --stack "$STACK")
# Strip /$default suffix that API Gateway appends to the no-custom-domain URL
URL="${RAW_URL%/\$default}"
echo "Verifying $STACK web-embed deployment at: $URL"

verify() {
  local path="$1"
  local attempt
  for attempt in 1 2 3; do
    if curl --fail --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --output /dev/null "$URL$path"; then
      echo "OK: $URL$path"
      return 0
    fi
    echo "Attempt $attempt failed for $URL$path — retrying in 5s"
    sleep 5
  done
  echo "--- Diagnostic dump for $URL$path ---"
  curl --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --dump-header - "$URL$path" | head -20
  return 1
}

verify "/embed"
verify "/embed/preview"
verify "/embed/icon.svg"
