# Dockerfile: self-hosted GHA runner for readplace.com CI, arm64.
# Base: myoung34/github-runner. Entrypoint handles registration, the
# ephemeral re-register loop, and token minting from a PAT.
# Verified: ubuntu-noble tag ships an arm64 manifest.
FROM myoung34/github-runner:ubuntu-noble

ENV DEBIAN_FRONTEND=noninteractive

# ci.yml assumptions the hosted image provides silently:
# jq + openssl (detect-projects), zstd (actions/cache),
# build-essential + python3 (node-gyp).
RUN apt-get update && apt-get install -y \
    jq unzip zstd openssl build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

# Node 22 + pnpm 9.15.0: the exact pins in ci.yml.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && npm install -g pnpm@9.15.0 \
 && rm -rf /var/lib/apt/lists/*

# Pulumi: absent binary reads as "drift unknown" in check-infra and
# force-redeploys every project. Installer's --install-root verified.
RUN curl -fsSL https://get.pulumi.com | sh -s -- --install-root /usr/local/pulumi \
 && ln -s /usr/local/pulumi/bin/pulumi /usr/local/bin/pulumi

# Playwright: OS libs baked into the image, browsers into /ms-playwright.
# Compose mounts a named volume there; Docker copies the baked browsers
# into the volume on first use, and any lockfile version drift self-heals
# by downloading into the volume instead of forcing an image rebuild.
# Pin to the repo's version at build time:
#   --build-arg PLAYWRIGHT_VERSION=$(jq -r '.devDependencies["@playwright/test"]' projects/hutch/package.json)
ARG PLAYWRIGHT_VERSION=1.60.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright \
 && npx -y playwright@${PLAYWRIGHT_VERSION} install-deps \
 && npx -y playwright@${PLAYWRIGHT_VERSION} install chromium firefox webkit

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

# Native arm64 Firefox + geckodriver for the selenium firefox-extension E2E.
# Firefox (unlike Chrome-for-Testing) ships a linux-aarch64 build, so no
# emulation; selenium needs both firefox and geckodriver on PATH.
RUN apt-get update && apt-get install -y wget bzip2 libdbus-glib-1-2 \
 && wget -qO /tmp/ff.tar.xz "https://download.mozilla.org/?product=firefox-latest&os=linux64-aarch64&lang=en-US" \
 && tar -xJf /tmp/ff.tar.xz -C /opt \
 && ln -sf /opt/firefox/firefox /usr/local/bin/firefox \
 && wget -qO /tmp/gd.tar.gz "https://github.com/mozilla/geckodriver/releases/download/v0.35.0/geckodriver-v0.35.0-linux-aarch64.tar.gz" \
 && tar -xzf /tmp/gd.tar.gz -C /usr/local/bin \
 && rm -f /tmp/ff.tar.xz /tmp/gd.tar.gz && rm -rf /var/lib/apt/lists/*

# Pre-bake Chrome-for-Testing + a matching chromedriver so the chrome-extension
# E2E skips the ~150 MB per-job download. install-chrome-for-testing.js reuses
# these via CFT_BAKED_DIR; it downloads normally when the env is unset.
RUN mkdir -p /opt/cft \
 && CHROME_OUT=$(npx -y @puppeteer/browsers install chrome@stable --path /opt/cft) \
 && echo "$CHROME_OUT" | tail -1 | sed -E 's/^chrome@[^ ]+ //' > /opt/cft/binary-path \
 && CHROME_VER=$(echo "$CHROME_OUT" | tail -1 | sed -E 's/^chrome@([^ ]+).*/\1/') \
 && DRIVER_OUT=$(npx -y @puppeteer/browsers install "chromedriver@${CHROME_VER}" --path /opt/cft) \
 && echo "$DRIVER_OUT" | tail -1 | sed -E 's/^chromedriver@[^ ]+ //' > /opt/cft/driver-path
ENV CFT_BAKED_DIR=/opt/cft

# docker CLI + buildx plugin: detect-projects builds the save-link OCR image via
# `docker buildx build --push` (projects/save-link/tools/build-image.mjs) against
# the HOST OrbStack daemon (socket bind-mounted in docker-compose.yml). Only the
# client + buildx are needed here — the daemon and its persistent buildkit layer
# cache live on the host, which is what makes the rebuild fast across jobs. arm64.
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y docker-ce-cli docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

# AWS CLI v2: build-image.mjs calls `aws ecr get-login-password` /
# `describe-repositories`. The myoung34 base image already ships it; install only
# if a future base drops it (the installer errors out on a preexisting install).
RUN [ -d /usr/local/aws-cli ] || command -v aws >/dev/null 2>&1 || ( \
      curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip \
   && unzip -q /tmp/awscliv2.zip -d /tmp \
   && /tmp/aws/install \
   && rm -rf /tmp/aws /tmp/awscliv2.zip )

# The PAT reaches the runner as a root-only file, never as an env var, so it is
# absent from the container environment (and thus from /proc/1/environ, which a
# root job could otherwise read). Jobs run as the unprivileged `runner` user, so
# the caches must be writable by it.
COPY entrypoint-secure.sh /usr/local/bin/entrypoint-secure.sh
RUN chmod 0755 /usr/local/bin/entrypoint-secure.sh \
 && mkdir -p /ms-playwright /opt/hostedtoolcache \
 && chown -R runner:runner /ms-playwright /opt/hostedtoolcache
