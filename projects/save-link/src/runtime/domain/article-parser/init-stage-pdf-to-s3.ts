/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { HutchLogger } from "@packages/hutch-logger";
import type { StagedPdf, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";

/**
 * Staging prefix under the content bucket. A 24 h S3 lifecycle rule (declared
 * alongside the bucket in infra/) deletes any objects under this prefix as the
 * backstop if the orchestrator's best-effort cleanup fails.
 */
export const PDF_STAGING_PREFIX = "pdf-rasterise-staging";

export function initStagePdfToS3(deps: {
	client: S3Client;
	bucketName: string;
	logger: HutchLogger;
}): { stagePdf: StagePdfToS3 } {
	const { client, bucketName, logger } = deps;

	const stagePdf: StagePdfToS3 = async (buffer): Promise<StagedPdf> => {
		const key = `${PDF_STAGING_PREFIX}/${randomUUID()}/source.pdf`;
		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: key,
				Body: buffer,
				ContentType: "application/pdf",
			}),
		);
		logger.info(`[stage-pdf] staged key=${key} bytes=${buffer.length}`);
		return {
			key,
			cleanup: async () => {
				try {
					await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
					logger.info(`[stage-pdf] cleaned up key=${key}`);
				} catch (error) {
					logger.warn(`[stage-pdf] cleanup failed key=${key} error=${String(error)}`);
				}
			},
		};
	};

	return { stagePdf };
}
/* c8 ignore stop */
