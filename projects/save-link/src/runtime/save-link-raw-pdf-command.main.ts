import { neverResolveChallengedTracker } from "@packages/save-article";
import { initSourceIdentityDepBundle } from "./dep-bundles/source-identity";
import { Agent } from "node:https";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { consoleLogger, Logger } from "@packages/logger";
import { setTimeout as sleep } from "node:timers/promises";
import { OCR_PAGE_QUOTA_RULE } from "@packages/domain/ocr-page-allowance";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import { initDynamoDbSubscriptionRead, initGetEffectiveAccess } from "@packages/subscription-access";
import { initDynamoDbOcrPageQuota } from "./providers/ocr-page-quota/dynamodb-ocr-page-quota";
import { initChargeOcrPagesForAccount } from "./providers/ocr-page-quota/select-ocr-charger";
import { EventBridgeClient } from "@packages/infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { extractPdfMetadata } from "@packages/crawl-article";
import { readEnv } from "@packages/require-env";
import { SAVE_LINK_RAW_PDF_COMMAND_ENV } from "./save-link-raw-pdf-command.env";
import { initReadPendingPdf } from "./providers/article-store/read-pending-pdf";
import { initSaveLinkRawPdfCommandHandler } from "./domain/save-link-raw-pdf/save-link-raw-pdf-command-handler";
import { initSaveLinkPdfExtract } from "./domain/article-parser/init-save-link-pdf-extract";
import { initStagePdfToS3 } from "./domain/article-parser/init-stage-pdf-to-s3";
import { initS3ParsedPdf } from "./providers/article-store/s3-parsed-pdf";
import { initInvokePdfPageOcr } from "./domain/article-parser/init-invoke-pdf-page-ocr";
import { initInvokePdfPageLlmCleanup } from "./domain/article-parser/init-invoke-pdf-page-llm-cleanup";
import { initInvokePdfDocumentDiffReview } from "./domain/article-parser/init-invoke-pdf-document-diff-review";
import { initInvokePdfPageHtmlConvert } from "./domain/article-parser/init-invoke-pdf-page-html-convert";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initCanonicalAliasStore } from "@packages/article-store";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";

const env = readEnv(SAVE_LINK_RAW_PDF_COMMAND_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const pendingPdfBucketName = env.PENDING_PDF_BUCKET_NAME;
const imagesCdnBaseUrl = env.IMAGES_CDN_BASE_URL;
const eventBusName = env.EVENT_BUS_NAME;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;
const pdfPageOcrFunctionName = env.PDF_PAGE_OCR_FUNCTION_NAME;
const pdfPageLlmCleanupFunctionName = env.PDF_PAGE_LLM_CLEANUP_FUNCTION_NAME;
const pdfDocumentDiffReviewFunctionName = env.PDF_DOCUMENT_DIFF_REVIEW_FUNCTION_NAME;
const pdfPageHtmlConvertFunctionName = env.PDF_PAGE_HTML_CONVERT_FUNCTION_NAME;

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

const { findParsedPdf, keepParsedPdf } = initS3ParsedPdf({ client: s3Client, bucketName: contentBucketName });

const extractPdf = initSaveLinkPdfExtract({
	extractPdfMetadata,
	stagePdf,
	invokePageOcr,
	invokePageLlmCleanup,
	invokeDocumentDiffReview,
	invokePageHtmlConvert,
	findParsedPdf,
	keepParsedPdf,
	logger: consoleLogger,
});

// PDFs handed to this Lambda already arrived in tier-0 form from the browser —
// there is no second HTTP crawl. Reuse the simple-only parser bundle for the
// readability pipeline; only `parseHtml` is exercised by the handler.
const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link-raw-pdf", now });
const canonicalAliasStore = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const parser = initParserDepBundle({
	logError: observability.logError,
	logInfo: observability.logInfo,
	logThumbnailNotDelivered: observability.logThumbnailNotDelivered,
	findAdoptedFetchUrl: canonicalAliasStore.findAdoptedFetchUrl,
});
const sourceIdentity = initSourceIdentityDepBundle({ findIdentityRow: canonicalAliasStore.findIdentityRow, repairWrapperIdentity: canonicalAliasStore.repairWrapperIdentity, crawlFetch: parser.crawlFetch, resolveChallengedTracker: neverResolveChallengedTracker, logger: consoleLogger });
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({
	parser,
	articleStore,
	logError: observability.logError,
	logImageLeftAtOrigin: observability.logImageLeftAtOrigin,
	imagesCdnBaseUrl,
});
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({
	dynamoClient,
	articlesTable,
	events,
	logCrawlSettled: observability.logCrawlSettled,
});

const { readPendingPdf } = initReadPendingPdf({ client: s3Client, bucketName: pendingPdfBucketName });

const ocrPageQuota = initDynamoDbOcrPageQuota({
	client: dynamoClient,
	tableName: env.DYNAMODB_RATE_LIMITS_TABLE,
	rule: OCR_PAGE_QUOTA_RULE,
	now,
	delay: (milliseconds) => sleep(milliseconds),
});
const subscriptionRead = initDynamoDbSubscriptionRead({ client: dynamoClient, tableName: env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE });
const chargeOcrPagesFor = initChargeOcrPagesForAccount({
	getEffectiveAccess: initGetEffectiveAccess({ findSubscriptionByUserId: subscriptionRead.findByUserId, now }),
	quota: ocrPageQuota.chargeOcrPagesFor,
});
const { markOcrPagesHeld } = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: env.DYNAMODB_ARTICLES_TABLE,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
	logger: Logger.from(consoleLogger),
	now,
});
export const handler = initSaveLinkRawPdfCommandHandler({
	...sourceIdentity,
	readPendingPdf,
	extractPdf,
	chargeOcrPagesFor,
	markOcrPagesHeld,
	parseHtml: parser.parseHtml,
	downloadMedia: media.downloadMedia,
	processContent: media.processContent,
	putTierSource: articleStore.putTierSource,
	publishEvent: events.publishEvent,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	now,
	logger: consoleLogger,
	logParseError: observability.logParseError,
	logCrawlOutcome: observability.logCrawlOutcome,
	readTierSnapshot: articleStore.readTierSnapshot,
});
