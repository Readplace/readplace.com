# Lambda container image for the comprehensive-crawl-command handler.
# Parameterised by HANDLER_DIR so the same Dockerfile can be reused if more
# handlers are containerised later.
#
# Build context: projects/save-link/. The .mjs build script bundles the
# handler with esbuild into .lib/<handler>/ and runs `docker buildx build
# --platform linux/amd64 --build-arg HANDLER_DIR=.lib/<handler> ...`,
# producing one image per Lambda.

# Tesseract is not in AL2023's default repos and the Lambda base image's
# stripped-down dnf can't fetch the EPEL release RPM via URL directly. Build
# tesseract on rockylinux:9 (RHEL 9, same glibc 2.34 as AL2023) where EPEL
# installs cleanly, then copy the binary + language data + shared libs into
# the Lambda image. Putting libs under /opt/tesseract-lib avoids any clash
# with libstdc++/libgomp already present in the AL2023 base.
FROM rockylinux:9 AS tesseract-stage
RUN dnf install -y epel-release && \
    dnf install -y tesseract tesseract-langpack-eng && \
    dnf clean all && \
    mkdir -p /opt/tesseract-lib && \
    ldd /usr/bin/tesseract \
      | awk '{ for (i=1; i<=NF; i++) if ($i ~ /^\/.*\.so/) print $i }' \
      | grep -v -E '/(libc|libpthread|libdl|libm|libgcc_s|ld-linux)' \
      | xargs -I {} cp -L --no-clobber {} /opt/tesseract-lib/

FROM public.ecr.aws/lambda/nodejs:22

# poppler-utils provides pdftoppm + pdfinfo + pdftotext; tar + gzip are needed
# to extract the curl-impersonate tarball below. Cleaning the dnf cache shaves
# ~30 MB. curl is intentionally not installed — the base image already
# provides curl-minimal (enough to fetch the tarball), and runtime fetches go
# through curl-impersonate for TLS-fingerprint bypass.
RUN dnf install -y poppler-utils tar gzip && dnf clean all

# Tesseract OCR (staging POC replacement for DeepInfra). Binary at
# /opt/tesseract/bin/tesseract, language data at /opt/tesseract/tessdata,
# shared libs at /opt/tesseract-lib (added to LD_LIBRARY_PATH below).
COPY --from=tesseract-stage /usr/bin/tesseract /opt/tesseract/bin/tesseract
COPY --from=tesseract-stage /usr/share/tesseract/tessdata /opt/tesseract/tessdata
COPY --from=tesseract-stage /opt/tesseract-lib /opt/tesseract-lib
ENV TESSDATA_PREFIX=/opt/tesseract/tessdata
ENV LD_LIBRARY_PATH=/opt/tesseract-lib:${LD_LIBRARY_PATH}

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

ENV PATH="/opt/bin:/opt/tesseract/bin:${PATH}"

ARG HANDLER_DIR
COPY ${HANDLER_DIR}/ ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
