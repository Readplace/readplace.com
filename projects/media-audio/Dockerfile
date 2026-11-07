ARG FFMPEG_IMAGE_REF
FROM mwader/static-ffmpeg:${FFMPEG_IMAGE_REF} AS ffmpeg

FROM public.ecr.aws/lambda/nodejs:22
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/

ARG HANDLER_DIR
COPY ${HANDLER_DIR}/ ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
