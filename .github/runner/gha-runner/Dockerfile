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
