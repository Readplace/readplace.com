import { initSourceIdentityDepBundle } from "./dep-bundles/source-identity";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { consoleLogger } from "@packages/logger";
import { EventBridgeClient, initHandleByDetailType } from "@packages/infra-components/runtime";
import { ResolveArticleOnViewCommand, StaleCheckRequestedEvent, SubmitLinkCommand } from "@packages/infra-components";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { requireEnv } from "@packages/require-env";
import { isBlockedIpAddress, validateSaveableUrl } from "@packages/domain/article";
import { CRAWL_PERSONAS, DEFAULT_CRAWL_HEADERS, initCrawlFetch, initResolveThroughUnlocker } from "@packages/crawl-article";
import {
	initCanonicalAliasStore,
	initDynamoDbArticleCrawl,
	initDynamoDbGeneratedSummary,
	initDynamoDbSavedArticleStore,
} from "@packages/article-store";
import { initSubmitLinkCommandHandler } from "./domain/submit-link/submit-link-command-handler";
import { initResolveArticleOnViewHandler } from "./domain/resolve-on-view/resolve-article-on-view-handler";
import { initRunCrawlFromTier1 } from "./domain/save-link/run-crawl-from-tier1";
import {
	initFileArticleIntoReadlist,
	initResolveSaveIdentity,
	initSubmitFreshness,
} from "@packages/save-article";
import { initOnboardingSignals } from "@packages/onboarding-signals";
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
const onboardingTable = requireEnv("DYNAMODB_ONBOARDING_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const crawlEgressProxyUrl = requireEnv("CRAWL_EGRESS_PROXY_URL");

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

const onboardingSignals = initOnboardingSignals({
	client: dynamoClient,
	onboardingTableName: onboardingTable,
	now,
});

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
const canonicalAliasStore = initCanonicalAliasStore({ client: dynamoClient, tableName: articlesTable });
const parser = initParserDepBundle({
	logError: observability.logError,
	logInfo: observability.logInfo,
	logThumbnailNotDelivered: observability.logThumbnailNotDelivered,
	findAdoptedFetchUrl: canonicalAliasStore.findAdoptedFetchUrl,
});
const sourceIdentity = initSourceIdentityDepBundle({ findIdentityRow: canonicalAliasStore.findIdentityRow, repairWrapperIdentity: canonicalAliasStore.repairWrapperIdentity, crawlFetch: parser.crawlFetch,
	resolveChallengedTracker: initResolveThroughUnlocker({
		crawlFetch: initCrawlFetch({
			fetch: globalThis.fetch,
			personas: CRAWL_PERSONAS,
			isBlocked: isBlockedIpAddress,
			logInfo: observability.logInfo,
			egress: { kind: "proxy-only", proxyUrl: crawlEgressProxyUrl },
		}),
		headers: DEFAULT_CRAWL_HEADERS,
	}),
	logger: consoleLogger,
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
const articleAggregate = initArticleAggregateDepBundle({
	dynamoClient,
	articlesTable,
	events,
	logCrawlSettled: observability.logCrawlSettled,
});
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });
const emitSimpleCrawlUnsupported = initEmitSimpleCrawlUnsupported({
	publishEvent: events.publishEvent,
});
const adoptCanonicalIdentity = initAdoptCanonicalIdentity({
	adoptDestination: canonicalAliasStore.adoptDestination,
	reconcileStubMetadata: canonicalAliasStore.reconcileStubMetadata,
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
const summaryStore = initDynamoDbGeneratedSummary({ client: dynamoClient, tableName: articlesTable, now });
const saveIdentityDeps = {
	validateUrl: validateSaveableUrl,
	findIdentityRow: canonicalAliasStore.findIdentityRow,
	claimAlias: canonicalAliasStore.claimAlias,
	now,
};
const { refreshArticleIfStale } = initSubmitFreshness({
	findArticleByUrl: savedArticleStore.findArticleByUrl,
	findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
	resolveSaveIdentity: initResolveSaveIdentity({ ...saveIdentityDeps, resolveWrapperTarget: sourceIdentity.resolveWrapperTarget }),
	publishStaleCheckRequested: (params) => events.publishEvent(StaleCheckRequestedEvent, params),
});

const crawlDeps = {
	...articleStore,
	...sourceIdentity,
	...events,
	...articleAggregate,
	...articleCrawl,
	...observability,
	crawlAndFinalizeArticle: crawlAndFinalize.crawlAndFinalizeArticle,
	emitSimpleCrawlUnsupported,
	adoptCanonicalIdentity,
	isSiteRuleUrl: parser.isSiteRuleUrl,
	now,
};

const submitLinkHandler = initSubmitLinkCommandHandler({
	...crawlDeps,
	validateSaveableUrl,
	saveArticle: savedArticleStore.saveArticle,
	allocateSavedAt: savedArticleStore.allocateSavedAt,
	fileArticleIntoReadlist: initFileArticleIntoReadlist({
		allocateSavedAt: savedArticleStore.allocateSavedAt,
		saveReadlistArticle: savedArticleStore.saveReadlistArticle,
		updateArticleStatusAcrossReadlists: savedArticleStore.updateArticleStatusAcrossReadlists,
	}),
	recordInboxArticleQueued: onboardingSignals.recordInboxArticleQueued,
	updateArticleStatus: savedArticleStore.updateArticleStatus,
	markCrawlPending: crawlStore.markCrawlPending,
	markSummaryPending: summaryStore.markSummaryPending,
	publishUpdateFetchTimestamp: articleCrawl.updateFetchTimestamp,
	refreshArticleIfStale,
	pinContentSource: canonicalAliasStore.pinContentSource,
});

const resolveArticleOnViewHandler = initResolveArticleOnViewHandler({
	loadArticle: articleAggregate.store.load,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	runCrawlFromTier1: initRunCrawlFromTier1({
		...crawlDeps,
		findContentSourceUrl: canonicalAliasStore.findContentSourceUrl,
		logPrefix: "[ResolveOnView]",
	}),
	publishEvent: events.publishEvent,
	now,
	logger: observability.logger,
});

export const handler = initHandleByDetailType({
	routes: {
		[SubmitLinkCommand.detailType]: [submitLinkHandler],
		[ResolveArticleOnViewCommand.detailType]: [resolveArticleOnViewHandler],
	},
	logger: observability.logger,
});
