/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

export type ReadPendingPdf = (url: string) => Promise<Buffer>;

export function initReadPendingPdf(deps: {
	client: S3Client;
	bucketName: string;
}): { readPendingPdf: ReadPendingPdf } {
	const { client, bucketName } = deps;

	const readPendingPdf: ReadPendingPdf = async (url) => {
		const key = `pending-pdf/${encodeURIComponent(ArticleResourceUniqueId.parse(url).value)}.pdf`;
		const result = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		assert(result.Body, "S3 GetObject response must have a Body");
		const bytes = await result.Body.transformToByteArray();
		return Buffer.from(bytes);
	};

	return { readPendingPdf };
}
/* c8 ignore stop */
