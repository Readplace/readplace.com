/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { HeadMediaPendingOriginal, ReadTimedDuration } from "@packages/domain";
import { stagedObjectKey } from "@packages/media-contracts";
import { parseFromTokenizer } from "music-metadata";
import { EndOfStreamError } from "strtok3";
import { rangedTokenizer } from "./ranged-tokenizer";
import { timedFactsOfMetadata } from "./timed-facts-of-metadata";

const READ_AHEAD_BYTES = { initial: 1024 * 1024, maximum: 32 * 1024 * 1024 };
const SCAN_BUDGET_MS = 6_000;

export function initS3ReadTimedDuration(deps: {
	client: S3Client;
	bucketName: string;
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	now: () => number;
}): {
	readTimedDuration: ReadTimedDuration;
} {
	const readTimedDuration: ReadTimedDuration = async ({ uploadId, etag }) => {
		const head = await deps.headMediaPendingOriginal({ uploadId });
		assert(head, `no pending original ${uploadId}`);
		const deadline = deps.now() + SCAN_BUDGET_MS;
		const tokenizer = rangedTokenizer({
			size: head.size,
			readAheadBytes: READ_AHEAD_BYTES,
			endOfStream: () => new EndOfStreamError(),
			budgetExhausted: () => deps.now() > deadline,
			readRange: async ({ start, end }) => {
				const object = await deps.client.send(
					new GetObjectCommand({
						Bucket: deps.bucketName,
						Key: stagedObjectKey(uploadId),
						Range: `bytes=${start}-${end - 1}`,
						IfMatch: etag,
					}),
				);
				assert(object.Body, "GetObject returned no body");
				return object.Body.transformToByteArray();
			},
		});
		return timedFactsOfMetadata(parseFromTokenizer(tokenizer, { duration: true, skipCovers: true }), {
			truncated: tokenizer.truncated,
		});
	};
	return { readTimedDuration };
}
/* c8 ignore stop */
