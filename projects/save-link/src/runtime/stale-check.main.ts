import { neverResolveChallengedTracker } from "@packages/save-article";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
	SaveAnonymousLinkCommand,
	UpdateFetchTimestampCommand,
} from "@packages/infra-components";
import { EventBridgeClient } from "@packages/infra-components/runtime";
import { consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import type {
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/provider-contracts/events";
import { initSourceIdentityDepBundle } from "./dep-bundles/source-identity";
import { newSaveAttemptId } from "@packages/domain/article";
import { initStaleCheckHandler } from "./domain/stale-check/stale-check-handler";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initCanonicalAliasStore, initDynamoDbArticleCrawl } from "@packages/article-store";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initCrawlAndFinalizeDepBundle } from "./dep-bundles/crawl-and-finalize";
import { initArticleCrawlDepBundle } from "./dep-bundles/article-crawl";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initEmitSimpleCrawlUnsupported, initEventsDepBundle } from "./dep-bundles/events";
import { initEventBridgeRefreshArticleContent, initPutRefreshHtml } from "@packages/refresh-article-content";
import { initFindArticleFreshness } from "./providers/article-crawl/find-article-freshness";
import { readEnv } from "@packages/require-env";
import { STALE_CHECK_ENV } from "./stale-check.env";

const env = readEnv(STALE_CHECK_ENV);

// Must match the staleness TTL the reading path applies. Reads of an article older than this
// trigger a conditional GET against the source (304 → noop, 200 → re-extract).
const STALE_TTL_MS = 86_400_000;

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;
const imagesCdnBaseUrl = env.IMAGES_CDN_BASE_URL;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;
const pendingHtmlBucketName = env.PENDING_HTML_BUCKET_NAME;

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});
const s3Client = new S3Client({});
const now = () => new Date();

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
const canonicalAliasStore = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const parser = initParserDepBundle({
	logError: observability.logError,
	logInfo: observability.logInfo,
	logThumbnailNotDelivered: observability.logThumbnailNotDelivered,
	findAdoptedFetchUrl: canonicalAliasStore.findAdoptedFetchUrl,
});
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
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });
const articleAggregate = initArticleAggregateDepBundle({
	dynamoClient,
	articlesTable,
	events,
	logCrawlSettled: observability.logCrawlSettled,
});
const emitSimpleCrawlUnsupported = initEmitSimpleCrawlUnsupported({
	publishEvent: events.publishEvent,
});

const { putRefreshHtml } = initPutRefreshHtml({ client: s3Client, bucketName: pendingHtmlBucketName });
const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({
	publishEvent: events.publishEvent,
	putRefreshHtml,
});

const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = (params) =>
	events.publishEvent(UpdateFetchTimestampCommand, params);

const publishSaveAnonymousLink: PublishSaveAnonymousLink = (params) =>
	events.publishEvent(SaveAnonymousLinkCommand, params);

const { findArticleFreshness } = initFindArticleFreshness({
	client: dynamoClient,
	tableName: articlesTable,
});

const { findArticleCrawlStatus } = initDynamoDbArticleCrawl({
	client: dynamoClient,
	tableName: articlesTable,
	now,
});

const sourceIdentity = initSourceIdentityDepBundle({ ...canonicalAliasStore, crawlFetch: parser.crawlFetch, resolveChallengedTracker: neverResolveChallengedTracker, logger: consoleLogger });

export const handler = initStaleCheckHandler({
	prepareArticleIdentity: sourceIdentity.prepareArticleIdentity,
	findArticleFreshness,
	findArticleCrawlStatus,
	crawlAndFinalizeArticle: crawlAndFinalize.crawlAndFinalizeArticle,
	publishRefreshArticleContent,
	publishUpdateFetchTimestamp,
	publishSaveAnonymousLink,
	emitSimpleCrawlUnsupported,
	markCrawlStage: articleCrawl.markCrawlStage,
	loadArticle: articleAggregate.store.load,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	now,
	newSaveAttemptId,
	staleTtlMs: STALE_TTL_MS,
	logger: consoleLogger,
});
