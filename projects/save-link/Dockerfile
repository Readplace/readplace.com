# Lambda container image for the comprehensive-crawl-command handler.
# Parameterised by HANDLER_DIR so the same Dockerfile can be reused if more
# handlers are containerised later.
#
# Build context: projects/save-link/. The .mjs build script bundles the
# handler with esbuild into .lib/<handler>/ and runs `docker buildx build
# --platform linux/amd64 --build-arg HANDLER_DIR=.lib/<handler> ...`,
# producing one image per Lambda.
FROM public.ecr.aws/lambda/nodejs:22

# poppler-utils provides pdftoppm + pdfinfo; tar + gzip are needed to extract
# the curl-impersonate tarball below. Cleaning the dnf cache shaves ~30 MB.
# curl is intentionally not installed — the base image already provides
# curl-minimal (enough to fetch the tarball), and runtime fetches go through
# curl-impersonate for TLS-fingerprint bypass.
RUN dnf install -y poppler-utils tar gzip && dnf clean all

# curl-impersonate (Chrome variant) for TLS-fingerprint bypass. The layer
# approach doesn't apply to container-image Lambdas, so we install the binary
# directly. curl_chrome116 is a bash wrapper that execs ./curl-impersonate-chrome
# from the same directory, so both files must be co-located in /opt/bin.
ARG CURL_IMPERSONATE_VERSION
RUN mkdir -p /opt/bin && \
    curl -fsSL "https://github.com/lexiforest/curl-impersonate/releases/download/v${CURL_IMPERSONATE_VERSION}/curl-impersonate-v${CURL_IMPERSONATE_VERSION}.x86_64-linux-gnu.tar.gz" \
      | tar --extract --gzip --directory /tmp && \
    cp /tmp/curl_chrome116 /tmp/curl-impersonate-chrome /opt/bin/ && \
    chmod 755 /opt/bin/curl_chrome116 /opt/bin/curl-impersonate-chrome && \
    rm -rf /tmp/curl_* /tmp/curl-impersonate-chrome

ENV PATH="/opt/bin:${PATH}"

ARG HANDLER_DIR
COPY ${HANDLER_DIR}/ ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
