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
