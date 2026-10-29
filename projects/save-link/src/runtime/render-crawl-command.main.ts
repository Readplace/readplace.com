import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import chromium from "@sparticuz/chromium";
import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { defaultResolveAll } from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import { requireEnv } from "@packages/require-env";
import { initCanonicalAliasStore } from "@packages/article-store";
import { initRenderCrawlHandler } from "./domain/render-crawl/render-crawl-handler";
import { initAdoptCanonicalIdentity } from "./domain/save-link/adopt-canonical-identity";
import { initDynamoDbPaidCrawlBudget } from "./providers/paid-crawl-budget/dynamodb-paid-crawl-budget";
import { initPuppeteerRenderPage } from "./providers/render-page/puppeteer-render-page";
import { initShouldAbortRequest } from "./providers/render-page/render-request-filter";
import { classifyRenderedDocument } from "./providers/render-page/classify-rendered-document";
import { parseRenderProxy } from "./providers/render-page/parse-render-proxy";
import { initSourceIdentityDepBundle } from "./dep-bundles/source-identity";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initCrawlAndFinalizeDepBundle } from "./dep-bundles/crawl-and-finalize";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initArticleCrawlDepBundle } from "./dep-bundles/article-crawl";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const rateLimitsTable = requireEnv("DYNAMODB_RATE_LIMITS_TABLE");
const renderCrawlBudget = parseRateLimitRule(requireEnv("RENDER_CRAWL_BUDGET"));
const crawlEgressProxyUrl = requireEnv("CRAWL_EGRESS_PROXY_URL");

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
const canonicalAliasStore = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const parser = initParserDepBundle({
	proxyUrl: crawlEgressProxyUrl,
	logError: observability.logError,
	logInfo: observability.logInfo,
	logThumbnailNotDelivered: observability.logThumbnailNotDelivered,
	findAdoptedFetchUrl: canonicalAliasStore.findAdoptedFetchUrl,
});
const sourceIdentity = initSourceIdentityDepBundle({ findIdentityRow: canonicalAliasStore.findIdentityRow, repairWrapperIdentity: canonicalAliasStore.repairWrapperIdentity, crawlFetch: parser.crawlFetch, logger: consoleLogger });
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({
	parser,
	articleStore,
	logError: observability.logError,
	logImageLeftAtOrigin: observability.logImageLeftAtOrigin,
	imagesCdnBaseUrl,
});
const crawlAndFinalize = initCrawlAndFinalizeDepBundle({
	parser,
	media,
	articleStore,
	imagesCdnBaseUrl,
	logError: observability.logError,
	logInfo: observability.logInfo,
	logThumbnailNotDelivered: observability.logThumbnailNotDelivered,
});
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });
const { consumePaidCrawlBudget: consumeRenderCrawlBudget } = initDynamoDbPaidCrawlBudget({
	client: dynamoClient,
	tableName: rateLimitsTable,
	scope: "render-crawl",
	rule: renderCrawlBudget,
	now,
});
const adoptCanonicalIdentity = initAdoptCanonicalIdentity({
	adoptDestination: canonicalAliasStore.adoptDestination,
	reconcileStubMetadata: canonicalAliasStore.reconcileStubMetadata,
	isSiteRuleUrl: parser.isSiteRuleUrl,
	now,
	logger: consoleLogger,
});
const RELAXED_ORIGIN_ARGS = new Set(["--disable-web-security"]);

const renderPage = initPuppeteerRenderPage({
	executablePath: () => chromium.executablePath(join(__dirname, "chromium-bin")),
	launchArgs: chromium.args.filter((arg) => !RELAXED_ORIGIN_ARGS.has(arg)),
	headless: "shell",
	shouldAbortRequest: initShouldAbortRequest({ resolve: defaultResolveAll, isBlocked: isBlockedIpAddress }),
	classifyRenderedDocument,
});

export const handler = initRenderCrawlHandler({
	...sourceIdentity,
	crawlArticle: parser.crawlArticle,
	finalizeArticle: crawlAndFinalize.finalizeArticle,
	...articleStore,
	...events,
	...articleAggregate,
	...articleCrawl,
	...observability,
	consumeRenderCrawlBudget,
	adoptCanonicalIdentity,
	renderPage,
	renderProxy: parseRenderProxy(crawlEgressProxyUrl),
	now,
});
