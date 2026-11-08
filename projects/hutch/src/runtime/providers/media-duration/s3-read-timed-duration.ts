/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import type { Readable } from "node:stream";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ReadTimedDuration } from "@packages/domain";
import { stagedObjectKey } from "@packages/media-contracts";
import { parseStream } from "music-metadata";
import { z } from "zod";
import { timedFactsOfMetadata } from "./timed-facts-of-metadata";

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
			return await timedFactsOfMetadata(
				parseStream(body, { size: object.ContentLength, mimeType: object.ContentType }, { duration: true, skipCovers: true }),
			);
		} finally {
			body.destroy();
		}
	};
	return { readTimedDuration };
}
/* c8 ignore stop */
