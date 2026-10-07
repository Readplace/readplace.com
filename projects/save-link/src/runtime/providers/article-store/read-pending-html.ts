/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import type { SaveAttemptId } from "@packages/domain/article";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";

export type ReadPendingHtml = (url: string, options: { saveAttemptId: SaveAttemptId }) => Promise<{ html: string; capturedAt: string }>;

export function initReadPendingHtml(deps: {
	client: S3Client;
	bucketName: string;
}): { readPendingHtml: ReadPendingHtml } {
	const { client, bucketName } = deps;

	const readPendingHtml: ReadPendingHtml = async (url, options) => {
		const key = ArticleResourceUniqueId.parse(url).toS3PendingHtmlKey(options.saveAttemptId);
		const result = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		assert(result.Body && result.LastModified, "staged capture must have a body and capture time");
		return { html: await result.Body.transformToString("utf-8"), capturedAt: result.LastModified.toISOString() };
	};

	return { readPendingHtml };
}
/* c8 ignore stop */
