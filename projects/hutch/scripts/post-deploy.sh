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

start_phase "checking every plan's Stripe price exists in the $STACK account"
# The price ids are discovered by lookup key at runtime, so the mistake this
# catches is a plan whose price is missing or archived in THIS account — the
# staging run gates prod, which cannot deploy until staging passes.
LOOKUP_KEYS=$(node -e "process.stdout.write(Object.values(require('./dist/runtime/domain/stripe/stripe-price-lookup-keys').STRIPE_PRICE_LOOKUP_KEYS).join('\\n'))")
while IFS= read -r lookup_key; do
  [ -n "$lookup_key" ] || continue
  # String(), not `node -p`: `-p` inspects a number and colours it, so the
  # comparison below would never match the plain "1" it looks like.
  matches=$(curl --fail --silent --show-error --max-time 30 --get "https://api.stripe.com/v1/prices" \
    --user "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY is not set}:" \
    --data-urlencode "active=true" \
    --data-urlencode "lookup_keys[]=$lookup_key" \
    | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0, 'utf8')).data.length))")
  if [ "$matches" != "1" ]; then
    echo "No active Stripe price with lookup key '$lookup_key' in the $STACK account (found $matches)."
    echo "Create the price with that lookup key in this account, or reactivate it, then redeploy."
    exit 1
  fi
  echo "  $lookup_key -> 1 active price"
done <<< "$LOOKUP_KEYS"
finish_phase

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
