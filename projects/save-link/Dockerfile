# Lambda container image for the comprehensive-crawl-command handler.
# Parameterised by HANDLER_DIR so the same Dockerfile can be reused if more
# handlers are containerised later.
#
# Build context: projects/save-link/. The .mjs build script bundles the
# handler with esbuild into .lib/<handler>/ and runs `docker buildx build
# --platform linux/amd64 --build-arg HANDLER_DIR=.lib/<handler> ...`,
# producing one image per Lambda.
FROM public.ecr.aws/lambda/nodejs:22

# poppler-utils provides pdftoppm + pdfinfo, used by initPdftoppmRasterizer
# to rasterise PDFs to PNG and read page count + title metadata. Cleaning
# the dnf cache shaves ~30 MB off the final image.
RUN dnf install -y poppler-utils && dnf clean all

ARG HANDLER_DIR
COPY ${HANDLER_DIR}/ ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
