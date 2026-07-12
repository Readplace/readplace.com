#!/usr/bin/env bash
# Keeps the repo-admin PAT out of anything a job can reach.
#
# The stock entrypoint takes the PAT as ACCESS_TOKEN in the container's
# environment. It un-exports it, so it never lands in a job's own env — but the
# container's initial environment is still readable from /proc/1/environ, and
# jobs run as root, so any job could recover the raw PAT with one command.
#
# Instead the PAT arrives as a root-only file (a docker secret). It lives only
# in this shell, only long enough to mint a short-lived (1h) registration token,
# and is never exported. The runner is then handed that registration token —
# which can only register a runner, not administer the repo — and jobs are run
# as the unprivileged `runner` user, which can read neither /proc/1/environ nor
# the secret file.
set -euo pipefail

PAT_FILE=${PAT_FILE:-/root/gh-pat.env}
[[ -r ${PAT_FILE} ]] || { echo "entrypoint-secure: ${PAT_FILE} not readable" >&2; exit 1; }

pat=$(<"${PAT_FILE}")
repo=${REPO_URL#https://github.com/}

RUNNER_TOKEN=$(curl -fsSL -X POST \
  -H "Authorization: Bearer ${pat}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${repo}/actions/runners/registration-token" \
  | jq -er .token)
unset pat

# The caches are named volumes created root-owned; non-root jobs need them.
chown -R runner:runner /ms-playwright /opt/hostedtoolcache /home/runner /nx 2>/dev/null || true

# /persist (the fixed RUNNER_WORKDIR volume, plus the pnpm store once plan 2
# lands) must be runner-owned so the non-root job can own the checkout tree and
# create sibling dirs. Deliberately NOT on the recursive line above: this
# entrypoint runs at every container start (once per ephemeral job) and /persist
# grows to 100k+ files (workspace + store), so a per-job `chown -R` would cost
# seconds each run. Guard it to the first start of a fresh volume — the mount
# point is still root-owned then; a bare stat is a no-op thereafter. Same reason
# the stock /entrypoint.sh chowns the workdir non-recursively.
[ "$(stat -c %U /persist)" = runner ] || chown -R runner:runner /persist

# Block a job from reaching the OrbStack HOST (the Mac) — the one pivot class
# with no ubuntu-latest analogue. Verified reachable from a job:
# host.docker.internal (0.250.250.254) exposes e.g. postgres:5432. OrbStack maps
# the host into the fixed 0.250.0.0/16 range. Public internet (github, npm) is
# unaffected. Requires NET_ADMIN (granted in compose); skip gracefully if absent
# so the runner still comes up rather than failing closed.
if iptables -C OUTPUT -d 0.250.0.0/16 -j REJECT 2>/dev/null; then :
elif iptables -A OUTPUT -d 0.250.0.0/16 -j REJECT 2>/dev/null; then
  echo "entrypoint-secure: blocked job egress to OrbStack host range 0.250.0.0/16"
else
  echo "entrypoint-secure: WARNING could not add host-egress block (NET_ADMIN missing?)" >&2
fi

export RUNNER_TOKEN
exec env -u ACCESS_TOKEN -u GH_PAT /entrypoint.sh "$@"
