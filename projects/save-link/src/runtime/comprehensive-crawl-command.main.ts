import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { extractPdfMetadata } from "@packages/crawl-article";
import { requireEnv } from "../require-env";
import { initComprehensiveCrawlHandler } from "./domain/comprehensive-crawl/comprehensive-crawl-handler";
import { initSaveLinkPdfExtract } from "./domain/article-parser/init-save-link-pdf-extract";
import { initStagePdfToS3 } from "./domain/article-parser/init-stage-pdf-to-s3";
import { initInvokePdfPageOcr } from "./domain/article-parser/init-invoke-pdf-page-ocr";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initComprehensiveParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initArticleCrawlDepBundle } from "./dep-bundles/article-crawl";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const pdfPageOcrFunctionName = requireEnv("PDF_PAGE_OCR_FUNCTION_NAME");

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const lambdaClient = new LambdaClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

const { stagePdf } = initStagePdfToS3({ client: s3Client, bucketName: contentBucketName, logger: consoleLogger });
const { invokePageOcr } = initInvokePdfPageOcr({ client: lambdaClient, functionName: pdfPageOcrFunctionName, logger: consoleLogger });

const extractPdf = initSaveLinkPdfExtract({
	extractPdfMetadata,
	stagePdf,
	invokePageOcr,
	logger: consoleLogger,
});

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
const parser = initComprehensiveParserDepBundle({ logError: observability.logError, extractPdf });
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({ parser, articleStore, logger: consoleLogger, imagesCdnBaseUrl });
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });

export const handler = initComprehensiveCrawlHandler({
	comprehensiveCrawl: parser.comprehensiveCrawl,
	parseHtml: parser.parseHtml,
	...media,
	...articleStore,
	...events,
	...articleAggregate,
	...articleCrawl,
	...observability,
	imagesCdnBaseUrl,
	now,
});
