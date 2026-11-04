import { randomBytes, randomUUID } from "node:crypto";
import { neverResolveChallengedTracker } from "@packages/save-article";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import chromium from "@sparticuz/chromium";
import { consoleLogger } from "@packages/logger";
import { EventBridgeClient } from "@packages/infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { CRAWL_PERSONAS, defaultResolveAll, initCrawlArticle, initCrawlFetch } from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import { requireEnv } from "@packages/require-env";
import { z } from "zod";
import { initCanonicalAliasStore, initDynamoDbMeteredLegLedger } from "@packages/article-store";
import { initRenderCrawlHandler } from "./domain/render-crawl/render-crawl-handler";
import { initAdoptCanonicalIdentity } from "./domain/save-link/adopt-canonical-identity";
import { initDynamoDbPaidCrawlBudget } from "./providers/paid-crawl-budget/dynamodb-paid-crawl-budget";
import { initPuppeteerRenderPage } from "./providers/render-page/puppeteer-render-page";
import { initRejectRenderRequest, initRenderRequestFilter } from "./providers/render-page/render-request-filter";
import { initReportProxiedRenderAttempt, type RenderRequestDiagnostics } from "./domain/render-crawl/report-proxied-render-attempt";
import { classifyRenderedDocument } from "./providers/render-page/classify-rendered-document";
import { parseRenderProxy } from "./providers/render-page/parse-render-proxy";
import { initResidentialEgress } from "./providers/render-page/residential-egress";
import { RENDER_CRAWL_TIMEOUTS } from "./domain/render-crawl/timeouts";
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
const crawlResidentialProxyUrl = requireEnv("CRAWL_RESIDENTIAL_PROXY_URL");
const renderRequestDiagnostics = z.enum(["off", "hosts"]).parse(requireEnv<RenderRequestDiagnostics>("RENDER_REQUEST_DIAGNOSTICS"));

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
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
const articleAggregate = initArticleAggregateDepBundle({
	dynamoClient,
	articlesTable,
	events,
	logCrawlSettled: observability.logCrawlSettled,
});
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });
const { consumePaidCrawlBudget: consumeRenderCrawlBudget } = initDynamoDbPaidCrawlBudget({
	client: dynamoClient,
	tableName: rateLimitsTable,
	scope: "render-crawl",
	rule: renderCrawlBudget,
	now,
	delay: (milliseconds) => sleep(milliseconds),
});
const meteredLegLedger = initDynamoDbMeteredLegLedger({ client: dynamoClient, tableName: articlesTable, now });
const adoptCanonicalIdentity = initAdoptCanonicalIdentity({
	adoptDestination: canonicalAliasStore.adoptDestination,
	reconcileStubMetadata: canonicalAliasStore.reconcileStubMetadata,
	isSiteRuleUrl: parser.isSiteRuleUrl,
	now,
	logger: consoleLogger,
});
const RELAXED_ORIGIN_ARGS = new Set(["--disable-web-security"]);

const MAX_RESOURCE_HOST_BUCKETS = 100;
const rejectRenderRequest = initRejectRenderRequest({ resolve: defaultResolveAll, isBlocked: isBlockedIpAddress });

const renderPage = initPuppeteerRenderPage({
	executablePath: () => chromium.executablePath(join(__dirname, "chromium-bin")),
	launchArgs: chromium.args.filter((arg) => !RELAXED_ORIGIN_ARGS.has(arg)),
	headless: "shell",
	createRenderRequestFilter: initRenderRequestFilter({ rejectRenderRequest, maxResourceHostBuckets: MAX_RESOURCE_HOST_BUCKETS }),
	classifyRenderedDocument,
});

const proxiedCrawlArticle = initCrawlArticle({
	crawlFetch: initCrawlFetch({
		fetch: globalThis.fetch,
		personas: CRAWL_PERSONAS,
		isBlocked: isBlockedIpAddress,
		logInfo: observability.logInfo,
		egress: { kind: "proxy-only", proxyUrl: crawlEgressProxyUrl },
	}),
	siteRules: [],
	logError: observability.logError,
	logInfo: observability.logInfo,
	logThumbnailNotDelivered: observability.logThumbnailNotDelivered,
	fetchTimeouts: RENDER_CRAWL_TIMEOUTS.webUnlockerFetch,
});

export const handler = initRenderCrawlHandler({
	...sourceIdentity,
	findAdoptedFetchUrl: canonicalAliasStore.findAdoptedFetchUrl,
	crawlArticle: parser.crawlArticle,
	proxiedCrawlArticle,
	finalizeArticle: crawlAndFinalize.finalizeArticle,
	...articleStore,
	...events,
	...articleAggregate,
	...articleCrawl,
	...observability,
	consumeRenderCrawlBudget,
	...meteredLegLedger,
	adoptCanonicalIdentity,
	renderPage,
	residentialEgress: initResidentialEgress({
		proxy: parseRenderProxy(crawlResidentialProxyUrl),
		newSessionToken: () => randomBytes(8).toString("hex"),
	}),
	webUnlockerEgress: { kind: "web-unlocker", proxy: parseRenderProxy(crawlEgressProxyUrl) },
	reportProxiedRenderAttempt: initReportProxiedRenderAttempt({
		logger: consoleLogger,
		diagnostics: renderRequestDiagnostics,
		newRenderAttemptId: randomUUID,
	}),
	now,
});
