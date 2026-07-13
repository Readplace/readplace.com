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

# The caches are named volumes created root-owned; non-root jobs need them. These
# stay on the eager line: they are small enough to walk on every container start.
chown -R runner:runner /ms-playwright /opt/hostedtoolcache /home/runner 2>/dev/null || true

# /nx (the nx cache volume) gets the same stat-guard as /persist below, for the
# same reason: it is bounded at NX_MAX_CACHE_SIZE (5 GB) and already holds tens of
# thousands of files, so a recursive chown on every ephemeral job start would cost
# seconds each run. The mount point is only root-owned on a fresh volume.
[ "$(stat -c %U /nx)" = runner ] || chown -R runner:runner /nx

# nx's DbCache names its metadata db <machine-id>-v2.db, so when /etc/machine-id
# changes (a base-image re-pull regenerates it; a layer-cached rebuild does not)
# the fresh db tracks none of the artifacts already on the volume: every task
# misses, and the stranded content dirs are reclaimed by neither nx's GC nor
# NX_MAX_CACHE_SIZE, which only evict entries the current db knows about. Self-heal
# rather than leave ~500 MB to rot until an operator spots it and runs
# `docker volume rm`.
nx_id_marker=/nx/.machine-id
machine_id=$(cat /etc/machine-id)
if [ -r "${nx_id_marker}" ] && [ "$(cat "${nx_id_marker}")" != "${machine_id}" ]; then
  rm -rf /nx/cache /nx/workspace-data
  echo "entrypoint-secure: machine-id changed — wiped the now-orphaned nx cache"
fi
printf '%s' "${machine_id}" > "${nx_id_marker}"

# /persist (the fixed RUNNER_WORKDIR volume, plus the pnpm store at
# /persist/pnpm-store) must be runner-owned so the non-root job can own the
# checkout tree and create sibling dirs. Deliberately NOT on the recursive line
# above: this entrypoint runs at every container start (once per ephemeral job)
# and /persist grows to 100k+ files (workspace + store), so a per-job `chown -R`
# would cost seconds each run. Guard it to the first start of a fresh volume —
# the mount point is still root-owned then; a bare stat is a no-op thereafter.
# Same reason the stock /entrypoint.sh chowns the workdir non-recursively.
[ "$(stat -c %U /persist)" = runner ] || chown -R runner:runner /persist

# Prune the pnpm store weekly. It lives on /persist (runner-owned, above), grows
# a few MB per lockfile change, and never shrinks on its own. `pnpm store prune`
# drops packages no persisted checkout references; run it as the store's owner
# (runner) and gate on a marker file's age so it runs at most once a week, not on
# every ephemeral restart. npm_config_store_dir (set in compose) is in this env,
# so gosu passes it through and prune targets the right store. Never fatal — a
# failed prune or marker write must not stop the runner coming up (set -e is
# active and this runs before exec). Touch the marker as root, this script's
# user: root can always update the mtime, so a marker left mis-owned by manual
# operator poking can neither wedge startup nor jam the gate into re-pruning
# every boot; the `|| true` covers the only-if-/persist-is-broken remainder.
prune_marker=/persist/.pnpm-store-pruned
if [ ! -e "${prune_marker}" ] || [ -n "$(find "${prune_marker}" -mtime +7 2>/dev/null)" ]; then
  if gosu runner pnpm store prune >/dev/null 2>&1; then
    touch "${prune_marker}" || true
    echo "entrypoint-secure: pruned the pnpm store (weekly)"
  else
    echo "entrypoint-secure: WARNING pnpm store prune failed (non-fatal)" >&2
  fi
fi

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

# Grant the non-root `runner` user access to the docker socket, if mounted (the
# detect-projects job builds the save-link OCR image against the host OrbStack
# daemon). OrbStack presents the bind-mounted socket as root:root mode 0660, so a
# group member gets rw — the socket's group must therefore be one `runner` joins.
# We do NOT chmod/chown the socket: it is a host bind mount (same inode), so that
# would mutate the host's own docker socket. Instead we add `runner` to the
# socket's group. When that group is gid 0 (OrbStack's case) it is `root`; joining
# the root *group* does not expose the PAT — /root stays 0700 and the file 0400,
# unreadable by group. The stock entrypoint's own `_DOCKER_SOCK_GID` path can't
# handle gid 0 (it would groupmod a second group onto gid 0 and fail), which is
# why this is explicit. No-op when the socket is absent.
sock=/var/run/docker.sock
if [ -S "${sock}" ]; then
  sock_gid=$(stat -c %g "${sock}")
  grp=$(getent group "${sock_gid}" | cut -d: -f1 || true)
  if [ -z "${grp}" ]; then
    grp=docker
    if getent group "${grp}" >/dev/null; then groupmod -g "${sock_gid}" "${grp}"; else groupadd -g "${sock_gid}" "${grp}"; fi
  fi
  id -nG runner | tr ' ' '\n' | grep -qx "${grp}" || usermod -aG "${grp}" runner
  echo "entrypoint-secure: runner joined group '${grp}' (gid ${sock_gid}) for docker socket access"
fi

export RUNNER_TOKEN
exec env -u ACCESS_TOKEN -u GH_PAT /entrypoint.sh "$@"
