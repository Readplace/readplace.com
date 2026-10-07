import assert from "node:assert";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReadRefreshHtml } from "@packages/provider-contracts/refresh-html";

export function initReadRefreshHtml(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): { readRefreshHtml: ReadRefreshHtml } {
	const { client, bucketName } = deps;

	const readRefreshHtml: ReadRefreshHtml = async (url, options) => {
		const id = ArticleResourceUniqueId.parse(url);
		const result = await client.send(
			new GetObjectCommand({
				Bucket: bucketName,
				Key: options.representation === "evaluation"
					? id.toS3RefreshEvaluationHtmlKey(options.saveAttemptId)
					: id.toS3RefreshHtmlKey(options.saveAttemptId),
			}),
		);
		assert(result.Body, "S3 GetObject response must have a Body");
		return result.Body.transformToString("utf-8");
	};

	return { readRefreshHtml };
}
