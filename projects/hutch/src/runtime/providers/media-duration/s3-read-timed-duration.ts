/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import type { Readable } from "node:stream";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ReadTimedDuration } from "@packages/domain";
import { stagedObjectKey } from "@packages/media-contracts";
import { CouldNotDetermineFileTypeError, parseStream, UnsupportedFileTypeError } from "music-metadata";
import { z } from "zod";

const ObjectBodySchema = z.custom<Readable>((body) => body !== undefined && body !== null);

export function initS3ReadTimedDuration(deps: { client: S3Client; bucketName: string }): {
	readTimedDuration: ReadTimedDuration;
} {
	const readTimedDuration: ReadTimedDuration = async ({ uploadId, etag }) => {
		const object = await deps.client.send(
			new GetObjectCommand({ Bucket: deps.bucketName, Key: stagedObjectKey(uploadId), IfMatch: etag }),
		);
		const body = ObjectBodySchema.parse(object.Body);
		try {
			const { format } = await parseStream(
				body,
				{ size: object.ContentLength, mimeType: object.ContentType },
				{ duration: true, skipCovers: true },
			);
			if (format.duration === undefined) return { unreadable: true };
			return { durationSeconds: format.duration, hasAudio: format.hasAudio === true, hasVideo: format.hasVideo === true };
		} catch (error) {
			if (error instanceof CouldNotDetermineFileTypeError || error instanceof UnsupportedFileTypeError) {
				return { unreadable: true };
			}
			throw error;
		} finally {
			body.destroy();
		}
	};
	return { readTimedDuration };
}
/* c8 ignore stop */
