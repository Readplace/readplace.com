# Dockerfile: self-hosted GHA runner for readplace.com CI, arm64.
# Base: myoung34/github-runner. Entrypoint handles registration, the
# ephemeral re-register loop, and token minting from a PAT.
# Verified: ubuntu-noble tag ships an arm64 manifest.

# Every browser this runner uses comes from the digest in
# .github/browser-image/image.env -- the same one the hosted jobs materialise, so
# both runner families test against identical browsers. rebuild.sh passes it;
# there is no default, because a runner built from an unpinned browser is the
# thing this removes.
ARG BROWSER_IMAGE
FROM ${BROWSER_IMAGE} AS browsers

FROM myoung34/github-runner:ubuntu-noble

ENV DEBIAN_FRONTEND=noninteractive

# ci.yml assumptions the hosted image provides silently:
# jq + openssl (detect-projects), zstd (actions/cache),
# build-essential + python3 (node-gyp).
RUN apt-get update && apt-get install -y \
    jq unzip zstd openssl build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

# Node 22 + pnpm 10.28.0: the exact pins in ci.yml.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && npm install -g pnpm@10.28.0 \
 && rm -rf /var/lib/apt/lists/*

# Pulumi: absent binary reads as "drift unknown" in check-infra and
# force-redeploys every project. Installer's --install-root verified.
RUN curl -fsSL https://get.pulumi.com | sh -s -- --install-root /usr/local/pulumi \
 && ln -s /usr/local/pulumi/bin/pulumi /usr/local/bin/pulumi

# Playwright: OS libs from install-deps, browsers COPYed from the pinned image
# below. No named volume any more -- one mounted at /ms-playwright would shadow
# these with whatever a past job downloaded, which is exactly the runtime
# replacement the pin exists to stop.
# Keep PLAYWRIGHT_VERSION in step with the repo:
#   --build-arg PLAYWRIGHT_VERSION=$(jq -r '.devDependencies["@playwright/test"]' projects/hutch/package.json)
ARG PLAYWRIGHT_VERSION=1.60.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install-deps

# Chrome-for-Testing ships only linux64 (x86-64); on this arm64 runner the
# chrome-extension E2E runs it under OrbStack's Rosetta, which needs the amd64
# loader + Chrome's amd64 runtime libs. arm64 Ubuntu apt (ports.ubuntu.com) has
# no amd64 packages, so pin the existing sources to arm64 and add the amd64
# archive. Emulated Chrome cold-starts ~3x slower than native — the arm64 tax.
RUN dpkg --add-architecture amd64 \
 && sed -i '/^Types:/a Architectures: arm64' /etc/apt/sources.list.d/ubuntu.sources \
 && sed -i '/^Types:/a Architectures: arm64' /etc/apt/sources.list.d/nodesource.sources \
 && printf 'Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\nSuites: noble noble-updates noble-security\nComponents: main universe\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' > /etc/apt/sources.list.d/amd64.sources \
 && apt-get update && apt-get install -y \
      libc6:amd64 libglib2.0-0t64:amd64 libnss3:amd64 libnspr4:amd64 \
      libatk1.0-0t64:amd64 libatk-bridge2.0-0t64:amd64 libcups2t64:amd64 \
      libdrm2:amd64 libdbus-1-3:amd64 libxcb1:amd64 libxkbcommon0:amd64 \
      libx11-6:amd64 libxcomposite1:amd64 libxdamage1:amd64 libxext6:amd64 \
      libxfixes3:amd64 libxrandr2:amd64 libgbm1:amd64 libpango-1.0-0:amd64 \
      libcairo2:amd64 libasound2t64:amd64 libatspi2.0-0t64:amd64 \
      libwayland-client0:amd64 libxshmfence1:amd64 libgtk-3-0t64:amd64 \
 && rm -rf /var/lib/apt/lists/*

# Every browser, from the one reviewed digest. Nothing here downloads a browser:
# a routine rebuild used to take whatever Mozilla and Google shipped that day,
# which is how 152.0.6 -> 153.0.3 landed on 2026-08-09 and broke every firefox
# suite (Firefox 153's WebDriver scheme allow-list) with no repo change to point
# at. A browser now moves only when image.env moves.
# libdbus-glib-1-2 is Firefox's load-time dependency and is apt-installed, not
# COPYed: COPY --from moves directories, never the packages a binary links to.
# firefox and geckodriver need to be on PATH for selenium and for the
# geckodriver preflight, which shells out to a bare `geckodriver`.
RUN apt-get update && apt-get install -y libdbus-glib-1-2 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=browsers --chown=runner:runner /ms-playwright /ms-playwright
COPY --from=browsers /opt/firefox /opt/firefox
COPY --from=browsers /opt/geckodriver /opt/geckodriver
COPY --from=browsers /opt/cft /opt/cft
RUN ln -sf /opt/firefox/firefox /usr/local/bin/firefox \
 && ln -sf /opt/geckodriver/geckodriver /usr/local/bin/geckodriver
ENV CFT_BAKED_DIR=/opt/cft

# We do NOT install docker-cli/buildx here (the base image already ships both).
# detect-projects' `save-link:check-infra` used to `docker buildx build --push`
# against the host OrbStack daemon just to compute the OCR image tag; it now runs
# `--tag-only` (esbuild + hash, no docker). The docker binary from the base image
# stays but is inert: docker-compose.yml no longer mounts /var/run/docker.sock, so
# it can reach no daemon — the escape it enabled is gone (verified: `docker ps`
# fails with "no such file or directory"). The real build+push stays in
# `save-link:deploy-infra`, which runs on a github-hosted runner.

# AWS CLI v2: build-image.mjs --tag-only calls `aws ecr describe-repositories` to
# resolve the ECR repo URL (read-only; `get-login-password` only runs on the
# github-hosted build+push path). The myoung34 base image already ships it;
# install only if a future base drops it (the installer errors on a preexisting one).
RUN [ -d /usr/local/aws-cli ] || command -v aws >/dev/null 2>&1 || ( \
      curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip \
   && unzip -q /tmp/awscliv2.zip -d /tmp \
   && /tmp/aws/install \
   && rm -rf /tmp/aws /tmp/awscliv2.zip )

# Drop the runner user's passwordless sudo. The base image puts `runner` in the
# sudo group (`%sudo ALL=(ALL) NOPASSWD: ALL`), which defeats the /root PAT seal:
# a job could `sudo cat /root/gh-pat.env` and take the repo-admin token. Nothing
# on this runner needs it — /entrypoint.sh drops privileges with gosu, not sudo,
# and the sole sudo caller (the `playwright install --with-deps` in
# @packages/test-phase-runner) is gone entirely: the OS libs come from
# `install-deps` above and the browsers from the pinned image, so no job installs
# a browser at all. Verified: a real E2E run executed all four suites on the
# sudo-less image with zero apt/sudo errors. runner-secret-audit.yml check 8
# asserts this stays closed. With the docker socket now also removed (the OCR
# build no longer runs here — see the docker note above), there is no known
# escape from a job to the PAT: non-root, no sudo, no socket, /root sealed.
RUN if id -nG runner | tr ' ' '\n' | grep -qx sudo; then gpasswd -d runner sudo; fi

# The PAT reaches the runner as a root-only file, never as an env var, so it is
# absent from the container environment (and thus from /proc/1/environ, which a
# root job could otherwise read). Jobs run as the unprivileged `runner` user, so
# the caches must be writable by it.
COPY entrypoint-secure.sh /usr/local/bin/entrypoint-secure.sh
RUN chmod 0755 /usr/local/bin/entrypoint-secure.sh \
 && mkdir -p /opt/hostedtoolcache \
 && chown -R runner:runner /opt/hostedtoolcache

# Pin the machine-id so the nx cache survives an image rebuild. nx names its
# DbCache metadata db "<machine-id>-v2.db" under NX_WORKSPACE_DATA_DIRECTORY (the
# /nx volume) and resolves the id as
#   ( cat /var/lib/dbus/machine-id /etc/machine-id ) | head -n 1
# — dbus FIRST, and the two are independent regular files here, NOT a symlink, so
# pinning only /etc/machine-id is a no-op. Neither ships in the base image (its
# /etc/machine-id is empty): systemd's postinst mints a RANDOM one when
# `playwright install-deps` pulls in dbus/systemd. The id is therefore
# non-deterministic layer output — any rebuild that re-executes that layer (a base
# re-pull, a BuildKit cache eviction) mints a new one, and the fresh db then tracks
# none of the artifacts already on /nx: every task misses SILENTLY (DbCache has no
# "not generated on this machine" error — that check lives in the legacy Cache
# class) and the strays are reclaimed by neither nx's GC nor NX_MAX_CACHE_SIZE.
# Keep this LAST: the postinsts above only generate an id into an absent/empty
# file, so a pin written after them is never overwritten (verified against a
# subsequent `apt-get install --reinstall dbus systemd`). Value is the id the
# current /nx db is already named after, so shipping this costs no cold run.
# Because the pin removes the accidental cache-busting the id churn used to give
# the browser builds above — which floated then, and are COPYed from a pinned
# digest now — the two extension projects declare those browser versions as an
# explicit nx `runtime` input.
RUN mkdir -p /var/lib/dbus \
 && printf '%s\n' d8afc387deb149a1bdbfa08f1d8ff78e | tee /etc/machine-id > /var/lib/dbus/machine-id
