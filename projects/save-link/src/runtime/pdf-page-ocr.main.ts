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

// Per-attempt timeout sized for DeepInfra single-image TTFB. Observed P99
// latency on the densest pages — yellowpaper-class math — sits at ~80s;
// 90s gives ~10s of headroom. SDK-level retries are disabled: a stuck
// DeepInfra socket inside a warm Lambda container tends to stay stuck for
// the full retry budget, while a fresh Lambda invocation gets a clean
// socket pool and usually clears the failure on the first try. Retries
// therefore live in the orchestrator (`PAGE_OCR_MAX_ATTEMPTS` in
// ocr-pdf.ts), which re-invokes this Lambda — typically into a new
// container — instead of looping on the same socket.
const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 90_000,
	maxRetries: 0,
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
