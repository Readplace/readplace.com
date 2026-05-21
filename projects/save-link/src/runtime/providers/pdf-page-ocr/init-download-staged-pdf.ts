/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { DownloadStagedPdf } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

export function initDownloadStagedPdf(deps: {
	client: S3Client;
	bucketName: string;
}): { downloadStagedPdf: DownloadStagedPdf } {
	const { client, bucketName } = deps;

	const downloadStagedPdf: DownloadStagedPdf = async ({ key }) => {
		const response = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		if (!response.Body) {
			throw new Error(`S3 GetObject returned no body for key=${key}`);
		}
		const chunks: Buffer[] = [];
		for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
			chunks.push(Buffer.from(chunk));
		}
		return Buffer.concat(chunks);
	};

	return { downloadStagedPdf };
}
/* c8 ignore stop */
