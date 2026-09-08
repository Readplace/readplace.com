#!/bin/bash
# Rebuild and redeploy the self-hosted runner in one step. A bare
# `docker compose up -d` recreates the container from whatever image is already
# built — that miss kept CI red on 2026-08-09 after the geckodriver 0.37.0
# Dockerfile fix had landed, because the live container silently kept the stale
# image. Verifying the toolchain after recreate is the point of this script.
#
# The browsers come from the digest in .github/browser-image/image.env, so a
# promotion is only live on this runner once this has been run. That is also the
# one moment the pinned versions are checked against a real container: the echo
# below prints what the recreated runner will actually test with.
set -euo pipefail
cd "$(dirname "$0")"

pin="../../browser-image/image.env"
set -a
. "$pin"
set +a
: "${CI_BROWSER_IMAGE:?not set in .github/browser-image/image.env — dispatch browser-image.yml and land the digest it prints}"

echo "--- browser image: ${CI_BROWSER_IMAGE} ---"
docker compose build --build-arg "BROWSER_IMAGE=${CI_BROWSER_IMAGE}"
docker compose up -d

echo "--- toolchain inside the recreated container ---"
docker compose exec gha-runner sh -c 'geckodriver --version 2>/dev/null | head -1; firefox --version 2>/dev/null; cat /opt/cft/binary-path; node --version'
echo "--- done. Verify the runner shows Idle: repo Settings -> Actions -> Runners ---"
