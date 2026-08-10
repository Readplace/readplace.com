#!/bin/bash
# Rebuild and redeploy the self-hosted runner in one step. A bare
# `docker compose up -d` recreates the container from whatever image is already
# built — that miss kept CI red on 2026-08-09 after the geckodriver 0.37.0
# Dockerfile fix had landed, because the live container silently kept the stale
# image. Verifying the toolchain after recreate is the point of this script.
set -euo pipefail
cd "$(dirname "$0")"

docker compose build
docker compose up -d

echo "--- toolchain inside the recreated container ---"
docker compose exec gha-runner sh -c 'geckodriver --version 2>/dev/null | head -1; firefox --version 2>/dev/null; node --version'
echo "--- done. Verify the runner shows Idle: repo Settings -> Actions -> Runners ---"
