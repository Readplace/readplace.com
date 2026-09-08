# The browser environment every CI browser job consumes.
#
# Built and validated by browser-image.yml, never by a test run, and consumed by
# digest. Two failure classes made this necessary: a 367MB per-run download that
# killed three runs before their tests started (33826579922, 33827125125,
# 33834457538 on 2026-09-04), and a browser changing underneath the suites with
# no commit to point at (the hosted image's Firefox 152.0.6 -> 153.0.3 on
# 2026-08-09, and 153.0.3 -> 154.0.1 since).
#
# Versions come from image.env and nowhere else, so a browser bump is a reviewed
# commit that this workflow then validates.

# The base already carries the chromium and firefox revisions @playwright/test
# 1.60.0 expects, already exports PLAYWRIGHT_BROWSERS_PATH, and is the image
# family the committed *-linux.png baselines were captured in (see
# browser-extension-core/src/build/visual-baselines.ts). Pinned to the manifest
# INDEX digest, never a per-platform one, or --platform cannot select a variant.
ARG PLAYWRIGHT_BASE_IMAGE
FROM ${PLAYWRIGHT_BASE_IMAGE}

ARG CHROME_FOR_TESTING_VERSION
ARG FIREFOX_VERSION
ARG GECKODRIVER_VERSION
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

# The base ships neither archiver this needs: @puppeteer/browsers fails with "no
# zip archiver is available" without unzip, and Mozilla's Firefox tarball is
# .tar.xz, which tar cannot unpack without xz-utils. libdbus-glib-1-2 is
# Firefox's load-time dependency and must travel with it -- a consumer that
# copies only /opt/firefox gets a binary that cannot start.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends unzip xz-utils wget libdbus-glib-1-2 \
 && rm --recursive --force /var/lib/apt/lists/*

# Chrome for Testing at an exact version, with the chromedriver of the SAME
# version string -- that pairing is what "compatible browser and driver" means
# mechanically, and it is what `chrome@stable` could never promise.
# Chrome for Testing publishes no linux-arm64 build, so the arm64 leg caches
# under linux_arm but holds the same x86-64 payload (verified: ELF e_machine
# 0x3e). That leg exists only to be COPY --from'd into the arm64 runner image,
# which runs it under OrbStack's Rosetta.
# binary-path and driver-path hold absolute paths and are the contract
# install-chrome-for-testing.js already reads through CFT_BAKED_DIR.
RUN mkdir --parents /opt/cft \
 && CHROME_OUT=$(npx --yes @puppeteer/browsers install "chrome@${CHROME_FOR_TESTING_VERSION}" --path /opt/cft) \
 && echo "$CHROME_OUT" | tail --lines 1 | sed --regexp-extended 's/^chrome@[^ ]+ //' > /opt/cft/binary-path \
 && DRIVER_OUT=$(npx --yes @puppeteer/browsers install "chromedriver@${CHROME_FOR_TESTING_VERSION}" --path /opt/cft) \
 && echo "$DRIVER_OUT" | tail --lines 1 | sed --regexp-extended 's/^chromedriver@[^ ]+ //' > /opt/cft/driver-path
ENV CFT_BAKED_DIR=/opt/cft

# Mozilla Firefox, not the base image's patched Playwright build: the selenium
# suites drive a real Firefox through geckodriver.
# geckodriver lands in its own directory rather than /usr/local/bin because the
# hosted consumer prepends this to PATH, and prepending a shared bin directory
# would shadow arbitrary runner binaries.
RUN case "${TARGETARCH}" in \
      amd64) FIREFOX_OS=linux64; GECKODRIVER_ASSET=linux64 ;; \
      arm64) FIREFOX_OS=linux64-aarch64; GECKODRIVER_ASSET=linux-aarch64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && wget --quiet --output-document /tmp/ff.tar.xz "https://download.mozilla.org/?product=firefox-${FIREFOX_VERSION}&os=${FIREFOX_OS}&lang=en-US" \
 && tar --extract --xz --file /tmp/ff.tar.xz --directory /opt \
 && mkdir --parents /opt/geckodriver \
 && wget --quiet --output-document /tmp/gd.tar.gz "https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-${GECKODRIVER_ASSET}.tar.gz" \
 && tar --extract --gzip --file /tmp/gd.tar.gz --directory /opt/geckodriver \
 && rm --force /tmp/ff.tar.xz /tmp/gd.tar.gz

# Fail the build, not a CI run three days later, when the image does not hold
# what image.env claims. Chrome is asserted on amd64 only: the arm64 leg carries
# an x86-64 binary that runs solely under Rosetta, which no runner here has.
RUN /opt/firefox/firefox --version | grep --fixed-strings "${FIREFOX_VERSION}" \
 && /opt/geckodriver/geckodriver --version | grep --fixed-strings "${GECKODRIVER_VERSION}" \
 && test -s /opt/cft/binary-path \
 && test -s /opt/cft/driver-path \
 && ls /ms-playwright | grep --quiet --extended-regexp '^chromium-' \
 && ls /ms-playwright | grep --quiet --extended-regexp '^firefox-' \
 && if [ "${TARGETARCH}" = "amd64" ]; then \
      "$(cat /opt/cft/binary-path)" --version | grep --fixed-strings "${CHROME_FOR_TESTING_VERSION}"; \
    fi
