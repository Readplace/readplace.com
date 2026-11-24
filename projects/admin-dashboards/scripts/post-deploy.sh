#!/bin/bash
set -euo pipefail

STACK="${PULUMI_STACK:?PULUMI_STACK is not set}"

USER_AGENT="Readplace-Deploy-Verify/1.0"

RAW_URL=$(pulumi stack output apiUrl --stack "$STACK")
URL="${RAW_URL%/\$default}"
echo "Verifying $STACK admin-dashboards deployment at: $URL"

verify_signed_out_redirect() {
  local path="$1"
  local attempt
  local headers
  for attempt in 1 2 3; do
    headers=$(curl --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --output /dev/null --dump-header - "$URL$path" | tr -d '\r')
    if grep --quiet --ignore-case '^HTTP/[0-9.]* 303' <<<"$headers" \
      && grep --quiet --ignore-case '^location: /login$' <<<"$headers" \
      && grep --quiet --ignore-case '^cache-control: no-store' <<<"$headers"; then
      echo "OK: $URL$path"
      return 0
    fi
    echo "Attempt $attempt failed for $URL$path — retrying in 5s"
    sleep 5
  done
  echo "--- Diagnostic dump for $URL$path ---"
  head -20 <<<"$headers"
  return 1
}

verify_signed_out_redirect "/admin/dashboards"
verify_signed_out_redirect "/admin/dashboards/login"
