/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import type { SaveAttemptId } from "@packages/domain/article";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

export type ReadPendingPdf = (url: string, options: { saveAttemptId: SaveAttemptId }) => Promise<{ bytes: Buffer; capturedAt: string }>;

export function initReadPendingPdf(deps: {
	client: S3Client;
	bucketName: string;
}): { readPendingPdf: ReadPendingPdf } {
	const { client, bucketName } = deps;

	const readPendingPdf: ReadPendingPdf = async (url, options) => {
		const key = ArticleResourceUniqueId.parse(url).toS3PendingPdfKey(options.saveAttemptId);
		const result = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		assert(result.Body && result.LastModified, "staged capture must have a body and capture time");
		const bytes = await result.Body.transformToByteArray();
		return { bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), capturedAt: result.LastModified.toISOString() };
	};

	return { readPendingPdf };
}
/* c8 ignore stop */
