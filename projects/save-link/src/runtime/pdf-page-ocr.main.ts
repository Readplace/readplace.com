import { S3Client } from "@aws-sdk/client-s3";
import OpenAI from "openai";
import { consoleLogger } from "@packages/hutch-logger";
import { renderPdfPageToPng } from "@packages/crawl-article";
import { requireEnv } from "../require-env";
import { initPdfPageOcrHandler } from "./domain/pdf-page-ocr/pdf-page-ocr-handler";
import { initCreateDeepInfraVisionMessage } from "./domain/article-parser/create-deepinfra-vision-message";
import { initDownloadStagedPdf } from "./providers/pdf-page-ocr/init-download-staged-pdf";
import { initLastPdfCache } from "./providers/pdf-page-ocr/init-last-pdf-cache";
import { initPdftotextExtract } from "./providers/pdf-page-ocr/init-pdftotext-extract";

const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const deepInfraApiKey = requireEnv("DEEPINFRA_API_KEY");

const s3Client = new S3Client({});

// Per-request SDK timeout sized to DeepInfra's empirical server-side cap
// plus a 100 s buffer. Observed: vision requests that don't return are
// closed by DeepInfra at ~302 s with the SDK reporting "Request timed
// out" — that's the server closing the socket, not the SDK's own clock
// firing. Raising the SDK timeout above ~302 s does not change wall
// clock for failing pages because the server tears down first; 400 s
// gives the SDK 100 s of headroom over the observed cap so we never
// give up before the server does. Successful vision calls in
// production have run as long as 360 s, so the buffer also covers
// pages that legitimately need the extra time before the model returns.
// The in-Lambda text-layer fallback (see pdf-page-ocr-handler.ts)
// recovers from the timeout for PDFs that carry an embedded text layer.
// maxRetries=0 because SDK-level retries would not bypass the server-
// side cap and the text-layer fallback is the recovery mechanism.
const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 400_000,
	maxRetries: 0,
});

const baseDownload = initDownloadStagedPdf({ client: s3Client, bucketName: contentBucketName });
const { downloadStagedPdf } = initLastPdfCache({ downloadStagedPdf: baseDownload.downloadStagedPdf });
const createVisionMessage = initCreateDeepInfraVisionMessage({
	createChatCompletion: (params) => deepInfraClient.chat.completions.create(params),
});
const { extractPageTextLayer } = initPdftotextExtract();

export const handler = initPdfPageOcrHandler({
	downloadStagedPdf,
	renderPdfPageToPng,
	createVisionMessage,
	extractPageTextLayer,
	logger: consoleLogger,
});
