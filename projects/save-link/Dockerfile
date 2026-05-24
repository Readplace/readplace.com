# Lambda container image for the comprehensive-crawl-command handler.
# Parameterised by HANDLER_DIR so the same Dockerfile can be reused if more
# handlers are containerised later.
#
# Build context: projects/save-link/. The .mjs build script bundles the
# handler with esbuild into .lib/<handler>/ and runs `docker buildx build
# --platform linux/amd64 --build-arg HANDLER_DIR=.lib/<handler> ...`,
# producing one image per Lambda.
FROM public.ecr.aws/lambda/nodejs:22

# poppler-utils provides pdftoppm + pdfinfo; curl is needed to download
# curl-impersonate in the next step. Cleaning the dnf cache shaves ~30 MB.
RUN dnf install -y poppler-utils curl && dnf clean all

# curl-impersonate (Chrome variant) for TLS-fingerprint bypass. The layer
# approach doesn't apply to container-image Lambdas, so we install the binary
# directly. Placed in /opt/bin with libs in /opt/lib to match the layer layout.
ARG CURL_IMPERSONATE_VERSION=0.8.0
RUN mkdir -p /opt/bin /opt/lib && \
    curl -fsSL "https://github.com/lexiforest/curl-impersonate/releases/download/v${CURL_IMPERSONATE_VERSION}/curl-impersonate-v${CURL_IMPERSONATE_VERSION}.x86_64-linux-gnu.tar.gz" \
      | tar --extract --gzip --directory /tmp && \
    cp /tmp/curl_chrome116 /opt/bin/ && \
    cp /tmp/*.so* /opt/lib/ && \
    chmod 755 /opt/bin/curl_chrome116 && \
    rm -rf /tmp/curl_*

ENV PATH="/opt/bin:${PATH}" \
    LD_LIBRARY_PATH="/opt/lib:${LD_LIBRARY_PATH}"

ARG HANDLER_DIR
COPY ${HANDLER_DIR}/ ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
