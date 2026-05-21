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

// Per-attempt timeout sized for DeepInfra single-image TTFB. With M=1 (see
// DEFAULT_BATCH_SIZE in ocr-pdf.ts) observed P99 latency on the densest
// pages we've seen — yellowpaper-class math — sits at ~80s. 90s gives
// ~10s of headroom over P99 without slack. Three attempts × 90s = 270s
// leaves ~330s under the 600s Lambda timeout for S3 download, pdftoppm,
// and stitching, and absorbs DeepInfra 429s without exhausting the budget
// on a single slow attempt.
const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 90_000,
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
