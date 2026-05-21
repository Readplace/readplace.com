#!/bin/bash
set -euo pipefail

STACK="${PULUMI_STACK:?PULUMI_STACK is not set}"

if [ "$STACK" != "staging" ]; then
  echo "No post-deploy E2E tests for $STACK — skipping"
  exit 0
fi

# Read the staging hutch API URL from hutch's pulumi stack output. Same backend
# (PULUMI_BACKEND_URL is set by the workflow), so a cd + pulumi stack output
# reads it without StackReference plumbing. Mirrors hutch/scripts/post-deploy.sh
# but cross-project, since chrome-extension's own stack does not export an URL —
# the pdf-save-flow staging test hits hutch, not the extension's S3.
RAW_URL=$(cd ../../hutch && pulumi stack output apiUrl --stack "$STACK")
# Strip /$default suffix that API Gateway appends to the URL
URL="${RAW_URL%/\$default}"
echo "Running chrome-extension pdf-save-flow staging E2E against: $URL"

# The pdf-save-flow staging harness is a node:test (no webdriver) that exercises
# the Siren walker contract against staging. STAGING_TEST_EMAIL and
# STAGING_TEST_PASSWORD are exported as env vars by the workflow's secrets-to-env
# shim (see .github/workflows/project-deployment.yaml). When unset the harness
# skips cleanly.
STAGING_URL="$URL" pnpm test:e2e:pdf-save-staging
