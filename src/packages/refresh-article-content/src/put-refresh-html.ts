/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";

export function initPutRefreshHtml(deps: {
	client: S3Client;
	bucketName: string;
}): { putRefreshHtml: PutRefreshHtml } {
	const { client, bucketName } = deps;

	const putRefreshHtml: PutRefreshHtml = async (params) => {
		const key = ArticleResourceUniqueId.parse(params.url).toS3RefreshHtmlKey();
		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: key,
				Body: params.html,
				ContentType: "text/html; charset=utf-8",
			}),
		);
	};

	return { putRefreshHtml };
}
/* c8 ignore stop */
