#!/bin/bash
# Materialise the digest-pinned browser image onto a github-hosted runner.
#
# One body, two callers: the pinned-browsers composite action, and an inline
# step in claude-listener.yml — that workflow runs main's copy of itself against
# an arbitrary PR head, so it cannot `uses:` a local action path, but it can run
# a script that arrived with the same checkout.
#
# Materialise rather than run the job inside the image: perf-tests is a
# wall-clock gate whose budgets were derived on a bare hosted VM, and a
# container job would move /dev/shm, the filesystem and the user underneath it.
# Copying only the browser bytes leaves the measured environment alone.
#
# The destinations are the image's own absolute paths because
# /opt/cft/binary-path and driver-path record absolute paths at build time, and
# the selenium chrome suites read those two files verbatim.
set -euo pipefail

pin=".github/browser-image/image.env"
test -f "$pin"
set -a
. "$pin"
set +a
: "${CI_BROWSER_IMAGE:?not set in $pin — dispatch browser-image.yml and land the digest it prints}"

echo "Browser image: ${CI_BROWSER_IMAGE}"
docker pull --quiet "$CI_BROWSER_IMAGE"

container=$(docker create "$CI_BROWSER_IMAGE" true)
for path in /opt/cft /opt/firefox /opt/geckodriver /ms-playwright; do
  sudo docker cp "${container}:${path}" "$path"
  # docker cp lands the tree root-owned; the job is not root.
  sudo chown --recursive "$(id --user):$(id --group)" "$path"
done
docker rm "$container" > /dev/null

{
  echo "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"
  echo "CFT_BAKED_DIR=/opt/cft"
} >> "$GITHUB_ENV"
{
  echo "/opt/geckodriver"
  echo "/opt/firefox"
} >> "$GITHUB_PATH"

/opt/firefox/firefox --version
/opt/geckodriver/geckodriver --version
echo "Chrome for Testing: $(cat /opt/cft/binary-path)"
