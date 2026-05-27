import { S3Client } from "@aws-sdk/client-s3";
import { consoleLogger } from "@packages/hutch-logger";
import { renderPdfPageToPng } from "@packages/crawl-article";
import { requireEnv } from "../require-env";
import { initPdfPageOcrHandler } from "./domain/pdf-page-ocr/pdf-page-ocr-handler";
import { initDownloadStagedPdf } from "./providers/pdf-page-ocr/init-download-staged-pdf";
import { initLastPdfCache } from "./providers/pdf-page-ocr/init-last-pdf-cache";
import { initTesseractOcr, resolveTessdataDir } from "./providers/pdf-page-ocr/init-tesseract-ocr";

const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");

const s3Client = new S3Client({});

const baseDownload = initDownloadStagedPdf({ client: s3Client, bucketName: contentBucketName });
const { downloadStagedPdf } = initLastPdfCache({ downloadStagedPdf: baseDownload.downloadStagedPdf });
const runPageOcr = initTesseractOcr({ tessdataDir: resolveTessdataDir() });

export const handler = initPdfPageOcrHandler({
	downloadStagedPdf,
	renderPdfPageToPng,
	runPageOcr,
	logger: consoleLogger,
});
