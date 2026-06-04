/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutPendingPdf } from "@packages/test-fixtures/providers/pending-pdf";

export function initPutPendingPdf(deps: {
	client: S3Client;
	bucketName: string;
}): { putPendingPdf: PutPendingPdf } {
	const { client, bucketName } = deps;

	const putPendingPdf: PutPendingPdf = async (params) => {
		const key = `pending-pdf/${encodeURIComponent(ArticleResourceUniqueId.parse(params.url).value)}.pdf`;
		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: key,
				Body: params.bytes,
				ContentType: "application/pdf",
			}),
		);
	};

	return { putPendingPdf };
}
/* c8 ignore stop */
