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

# The PAT is one unbacked-up secret, and losing it does not announce itself:
# `docker compose up -d` recreates a MISSING bind-mount source as an empty
# DIRECTORY, after which the runner crash-loops on a bare `curl 401` that reads
# like an expired token rather than an absent file. That is what happened on
# 2026-09-09, and the directory then reappears on every restart, so it also
# defeats the obvious fix. Check before compose runs, and say which it is.
pat="gh-pat.env"
if [ -d "$pat" ]; then
  echo "rebuild.sh: $pat is a DIRECTORY, not the token file." >&2
  echo "  docker created it because the file was missing when a container last started." >&2
  echo "  Fix: docker compose stop && rmdir '$PWD/$pat' && printf '%s' '<PAT>' > '$PWD/$pat'" >&2
  exit 1
fi
if [ ! -f "$pat" ] || [ ! -r "$pat" ] || [ ! -s "$pat" ]; then
  echo "rebuild.sh: $pat is missing, unreadable or empty." >&2
  echo "  Write the fine-grained PAT (Administration: Read and write on this repo)" >&2
  echo "  to '$PWD/$pat' — the token alone, no KEY= prefix." >&2
  exit 1
fi

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
