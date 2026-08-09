import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { StaleCheckRequestedEvent } from "@packages/hutch-infra-components";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { validateSaveableUrl } from "@packages/domain/article";
import {
	initCanonicalAliasStore,
	initDynamoDbArticleCrawl,
	initDynamoDbGeneratedSummary,
	initDynamoDbSavedArticleStore,
	initResolveCanonicalIdentity,
} from "@packages/article-store";
import { initSubmitLinkCommandHandler } from "./domain/submit-link/submit-link-command-handler";
import { initSubmitFreshness } from "@packages/save-article";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initCrawlAndFinalizeDepBundle } from "./dep-bundles/crawl-and-finalize";
import { initEmitSimpleCrawlUnsupported, initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initArticleCrawlDepBundle } from "./dep-bundles/article-crawl";
import { initAdoptCanonicalIdentity } from "./domain/save-link/adopt-canonical-identity";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

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
	findAdoptedFetchUrl: canonicalAliasStore.findAdoptedFetchUrl,
});
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({ parser, articleStore, logError: observability.logError, imagesCdnBaseUrl });
const crawlAndFinalize = initCrawlAndFinalizeDepBundle({
	parser,
	media,
	articleStore,
	imagesCdnBaseUrl,
	logError: observability.logError,
	logInfo: observability.logInfo,
});
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });
const emitSimpleCrawlUnsupported = initEmitSimpleCrawlUnsupported({
	publishEvent: events.publishEvent,
});
const adoptCanonicalIdentity = initAdoptCanonicalIdentity({
	claimAlias: canonicalAliasStore.claimAlias,
	setDisplayUrl: canonicalAliasStore.setDisplayUrl,
	isSiteRuleUrl: parser.isSiteRuleUrl,
	now,
	logger: consoleLogger,
});

const savedArticleStore = initDynamoDbSavedArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
	logger: observability.logger,
	now: () => new Date(),
});
const crawlStore = initDynamoDbArticleCrawl({ client: dynamoClient, tableName: articlesTable, now });
const summaryStore = initDynamoDbGeneratedSummary({ client: dynamoClient, tableName: articlesTable });
const resolveCanonicalIdentity = initResolveCanonicalIdentity({
	resolveAlias: canonicalAliasStore.resolveAlias,
});
const { refreshArticleIfStale } = initSubmitFreshness({
	findArticleByUrl: savedArticleStore.findArticleByUrl,
	findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
	resolveCanonicalIdentity,
	publishStaleCheckRequested: (params) => events.publishEvent(StaleCheckRequestedEvent, params),
});

export const handler = initSubmitLinkCommandHandler({
	...articleStore,
	...events,
	...articleAggregate,
	...articleCrawl,
	...observability,
	crawlAndFinalizeArticle: crawlAndFinalize.crawlAndFinalizeArticle,
	emitSimpleCrawlUnsupported,
	adoptCanonicalIdentity,
	now,
	validateSaveableUrl,
	saveArticle: savedArticleStore.saveArticle,
	updateArticleStatus: savedArticleStore.updateArticleStatus,
	markCrawlPending: crawlStore.markCrawlPending,
	markSummaryPending: summaryStore.markSummaryPending,
	publishUpdateFetchTimestamp: articleCrawl.updateFetchTimestamp,
	refreshArticleIfStale,
	resolveCanonicalIdentity,
});
