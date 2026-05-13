/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";

export type ReadPendingHtml = (url: string) => Promise<string>;

export function initReadPendingHtml(deps: {
	client: S3Client;
	bucketName: string;
}): { readPendingHtml: ReadPendingHtml } {
	const { client, bucketName } = deps;

	const readPendingHtml: ReadPendingHtml = async (url) => {
		const key = ArticleResourceUniqueId.parse(url).toS3PendingHtmlKey();
		const result = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		assert(result.Body, "S3 GetObject response must have a Body");
		return result.Body.transformToString("utf-8");
	};

	return { readPendingHtml };
}
/* c8 ignore stop */
