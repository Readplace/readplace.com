#!/bin/bash
set -euo pipefail

STACK="${PULUMI_STACK:?PULUMI_STACK is not set}"

USER_AGENT="Readplace-Deploy-Verify/1.0"

RAW_URL=$(pulumi stack output apiUrl --stack "$STACK")
# Strip /$default suffix that API Gateway appends to the no-custom-domain URL
URL="${RAW_URL%/\$default}"
echo "Verifying $STACK inbox deployment at: $URL"

# /inbox is auth-gated: logged out it must answer 303 See Other with a Location
# ending in /login. Asserting the exact status + target proves the inbox Lambda
# (not hutch's $default catch-all) answered the route. Deeper checks (address
# provisioning, email list) sit behind login and feature toggles, so this is
# the whole unauthenticated surface.
verify_auth_redirect() {
  local path="$1"
  local attempt response status location
  for attempt in 1 2 3; do
    response=$(curl --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --output /dev/null --write-out '%{http_code} %{redirect_url}' "$URL$path") || response=""
    status="${response%% *}"
    location="${response#* }"
    # Compare on the path only: the runtime may append a ?return=… query.
    if [ "$status" = "303" ] && [[ "${location%%\?*}" == */login ]]; then
      echo "OK: $path -> $status $location"
      return 0
    fi
    echo "Attempt $attempt failed for $URL$path (status=${status:-none} location=${location:-none}) — retrying in 5s"
    sleep 5
  done
  echo "--- Diagnostic dump for $URL$path ---"
  curl --silent --show-error --max-time 30 --user-agent "$USER_AGENT" --dump-header - "$URL$path" | head -20
  return 1
}

verify_auth_redirect "/inbox"

# --- SES email round-trip smoke (staging only — not yet enabled) ---
# End-to-end check of the receive → extract pipeline: send a message to a
# dedicated smoke address on the staging inbox domain, then poll until the
# email row (and its extracted link row) lands. It needs one-time seeding
# before it can ever pass: create a permanent smoke-test user on staging and
# provision its inbox address (e.g. smoke@readplace-staging.com) through the
# /inbox UI, then record that address below. Until that address exists, mail
# to it is dropped as an unknown recipient, so the block stays commented out
# to keep post-deploy non-blocking.
#
# if [ "$STACK" = "organization/inbox/staging" ]; then
#   SMOKE_ADDRESS="smoke@readplace-staging.com"
#   SMOKE_SUBJECT="post-deploy smoke $(date +%s)"
#   aws ses send-email \
#     --from "readplace+staging@readplace.com" \
#     --destination "ToAddresses=$SMOKE_ADDRESS" \
#     --message "Subject={Data=$SMOKE_SUBJECT},Body={Text={Data=https://example.com/}}"
#   # Poll the staging inbox-emails table (or the /inbox page as the smoke user)
#   # until a row with $SMOKE_SUBJECT appears, then assert its extracted link
#   # row for https://example.com/ exists.
# fi
