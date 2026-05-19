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

const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 300_000,
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
