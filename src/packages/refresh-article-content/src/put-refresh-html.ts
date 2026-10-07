import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";

export function initPutRefreshHtml(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): { putRefreshHtml: PutRefreshHtml } {
	const { client, bucketName } = deps;

	const putRefreshHtml: PutRefreshHtml = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		for (const [objectKey, html] of [
			[id.toS3RefreshHtmlKey(params.saveAttemptId), params.html],
			[id.toS3RefreshEvaluationHtmlKey(params.saveAttemptId), params.evaluationHtml],
		]) {
			await client.send(new PutObjectCommand({ Bucket: bucketName, Key: objectKey, Body: html, ContentType: "text/html; charset=utf-8" }));
		}
	};

	return { putRefreshHtml };
}
