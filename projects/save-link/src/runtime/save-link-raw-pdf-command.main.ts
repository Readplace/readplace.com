import { Agent } from "node:https";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { extractPdfMetadata } from "@packages/crawl-article";
import { requireEnv } from "../require-env";
import { initReadPendingPdf } from "./providers/article-store/read-pending-pdf";
import { initSaveLinkRawPdfCommandHandler } from "./domain/save-link-raw-pdf/save-link-raw-pdf-command-handler";
import { initSaveLinkPdfExtract } from "./domain/article-parser/init-save-link-pdf-extract";
import { initStagePdfToS3 } from "./domain/article-parser/init-stage-pdf-to-s3";
import { initInvokePdfPageOcr } from "./domain/article-parser/init-invoke-pdf-page-ocr";
import { initInvokePdfPageLlmCleanup } from "./domain/article-parser/init-invoke-pdf-page-llm-cleanup";
import { initInvokePdfDocumentDiffReview } from "./domain/article-parser/init-invoke-pdf-document-diff-review";
import { initInvokePdfPageHtmlConvert } from "./domain/article-parser/init-invoke-pdf-page-html-convert";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const pendingPdfBucketName = requireEnv("PENDING_PDF_BUCKET_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const pdfPageOcrFunctionName = requireEnv("PDF_PAGE_OCR_FUNCTION_NAME");
const pdfPageLlmCleanupFunctionName = requireEnv("PDF_PAGE_LLM_CLEANUP_FUNCTION_NAME");
const pdfDocumentDiffReviewFunctionName = requireEnv("PDF_DOCUMENT_DIFF_REVIEW_FUNCTION_NAME");
const pdfPageHtmlConvertFunctionName = requireEnv("PDF_PAGE_HTML_CONVERT_FUNCTION_NAME");

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const lambdaClient = new LambdaClient({
	requestHandler: new NodeHttpHandler({
		httpsAgent: new Agent({ maxSockets: 200 }),
	}),
});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

const { stagePdf } = initStagePdfToS3({ client: s3Client, bucketName: contentBucketName, logger: consoleLogger });
const { invokePageOcr } = initInvokePdfPageOcr({ client: lambdaClient, functionName: pdfPageOcrFunctionName, logger: consoleLogger });
const { invokePageLlmCleanup } = initInvokePdfPageLlmCleanup({ client: lambdaClient, functionName: pdfPageLlmCleanupFunctionName, logger: consoleLogger });
const { invokeDocumentDiffReview } = initInvokePdfDocumentDiffReview({ client: lambdaClient, functionName: pdfDocumentDiffReviewFunctionName, logger: consoleLogger });
const { invokePageHtmlConvert } = initInvokePdfPageHtmlConvert({ client: lambdaClient, functionName: pdfPageHtmlConvertFunctionName, logger: consoleLogger });

const extractPdf = initSaveLinkPdfExtract({
	extractPdfMetadata,
	stagePdf,
	invokePageOcr,
	invokePageLlmCleanup,
	invokeDocumentDiffReview,
	invokePageHtmlConvert,
	logger: consoleLogger,
});

// PDFs handed to this Lambda already arrived in tier-0 form from the browser —
// there is no second HTTP crawl. Reuse the simple-only parser bundle for the
// readability pipeline; only `parseHtml` is exercised by the handler.
const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link-raw-pdf", now });
const parser = initParserDepBundle({ logError: observability.logError });
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({ parser, articleStore, logger: consoleLogger, imagesCdnBaseUrl });
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });

const { readPendingPdf } = initReadPendingPdf({ client: s3Client, bucketName: pendingPdfBucketName });

export const handler = initSaveLinkRawPdfCommandHandler({
	readPendingPdf,
	extractPdf,
	parseHtml: parser.parseHtml,
	downloadMedia: media.downloadMedia,
	processContent: media.processContent,
	putTierSource: articleStore.putTierSource,
	publishEvent: events.publishEvent,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	logger: consoleLogger,
	logParseError: observability.logParseError,
	logCrawlOutcome: observability.logCrawlOutcome,
	readTierSnapshot: articleStore.readTierSnapshot,
});
