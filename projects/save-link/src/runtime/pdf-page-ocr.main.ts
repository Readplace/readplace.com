import { S3Client } from "@aws-sdk/client-s3";
import OpenAI from "openai";
import { consoleLogger } from "@packages/hutch-logger";
import { renderPdfPageToPng } from "@packages/crawl-article";
import { requireEnv } from "../require-env";
import { initPdfPageOcrHandler } from "./domain/pdf-page-ocr/pdf-page-ocr-handler";
import { initCreateDeepInfraVisionMessage } from "./domain/article-parser/create-deepinfra-vision-message";
import { initDownloadStagedPdf } from "./providers/pdf-page-ocr/init-download-staged-pdf";
import { initLastPdfCache } from "./providers/pdf-page-ocr/init-last-pdf-cache";

const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const deepInfraApiKey = requireEnv("DEEPINFRA_API_KEY");

const s3Client = new S3Client({});

// Per-attempt timeout sized for DeepInfra batched-image TTFB. With M=2 (see
// DEFAULT_BATCH_SIZE in ocr-pdf.ts), per-page budget is the prior M=1 cap
// (~90s) divided across the batch's pages — i.e. 90 / 3 ≈ 30s of model
// time per page. 120s covers 2 pages × 30s with a 60s buffer for the
// non-linear TTFB amplification multi-image batches show on dense content.
// Three attempts × 120s = 360s leaves ~240s under the 600s Lambda timeout
// for S3 download, pdftoppm, and stitching, and absorbs DeepInfra 429s
// without exhausting the budget on a single slow attempt.
const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 120_000,
	maxRetries: 2,
});

const baseDownload = initDownloadStagedPdf({ client: s3Client, bucketName: contentBucketName });
const { downloadStagedPdf } = initLastPdfCache({ downloadStagedPdf: baseDownload.downloadStagedPdf });
const createVisionMessage = initCreateDeepInfraVisionMessage({
	createChatCompletion: (params) => deepInfraClient.chat.completions.create(params),
});

export const handler = initPdfPageOcrHandler({
	downloadStagedPdf,
	renderPdfPageToPng,
	createVisionMessage,
	logger: consoleLogger,
});
