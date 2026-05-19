/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReadRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";

export function initReadRefreshHtml(deps: {
	client: S3Client;
	bucketName: string;
}): { readRefreshHtml: ReadRefreshHtml } {
	const { client, bucketName } = deps;

	const readRefreshHtml: ReadRefreshHtml = async (url) => {
		const key = ArticleResourceUniqueId.parse(url).toS3RefreshHtmlKey();
		const result = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		assert(result.Body, "S3 GetObject response must have a Body");
		return result.Body.transformToString("utf-8");
	};

	return { readRefreshHtml };
}
/* c8 ignore stop */
