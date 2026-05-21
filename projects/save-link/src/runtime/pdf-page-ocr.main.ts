import { S3Client } from "@aws-sdk/client-s3";
import OpenAI from "openai";
import { consoleLogger } from "@packages/hutch-logger";
import { renderPdfPageToPng } from "@packages/crawl-article";
import { requireEnv } from "../require-env";
import { initPdfPageOcrHandler } from "./domain/pdf-page-ocr/pdf-page-ocr-handler";
import { initCreateDeepInfraVisionMessage } from "./domain/article-parser/create-deepinfra-vision-message";
import { initDownloadStagedPdf } from "./providers/pdf-page-ocr/init-download-staged-pdf";

const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const deepInfraApiKey = requireEnv("DEEPINFRA_API_KEY");

const s3Client = new S3Client({});

// Per-attempt timeout sized for DeepInfra TTFB on multi-image dense-math
// pages — empirically the first-token wait can sit at 100-200s under load,
// so 120s was too aggressive (exhausted all retries, no successful response).
// 240s gives each attempt real room. Budget: 2 attempts × 240s = 480s,
// leaving 120s headroom under the 600s Lambda timeout for S3 download +
// pdftoppm + final stitching.
const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 240_000,
	maxRetries: 1,
});

const { downloadStagedPdf } = initDownloadStagedPdf({ client: s3Client, bucketName: contentBucketName });
const createVisionMessage = initCreateDeepInfraVisionMessage({
	createChatCompletion: (params) => deepInfraClient.chat.completions.create(params),
});

export const handler = initPdfPageOcrHandler({
	downloadStagedPdf,
	renderPdfPageToPng,
	createVisionMessage,
	logger: consoleLogger,
});
