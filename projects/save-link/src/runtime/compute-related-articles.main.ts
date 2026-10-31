import { type DeepseekUsageLine, initCreateDeepseekMessage, initDeepseekClient } from "@packages/ai-message";
import {
	initDynamoDbPastReads,
	initDynamoDbRelatedArticles,
} from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger, HutchLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initRelatedArticlesDepBundle } from "./dep-bundles/related-articles";
import { initComputeRelatedPasses } from "./domain/related-articles/compute-related-passes";
import { initComputeRelatedArticlesHandler } from "./domain/related-articles/compute-related-articles-handler";
import { initComputeRelatedPastReadsHandler } from "./domain/related-articles/compute-related-past-reads-handler";
import { initRecomputeSkippedNextReadHandler } from "./domain/related-articles/recompute-skipped-next-read-handler";
import { initGatherRelatedCandidatePools } from "./domain/related-articles/related-articles-candidates";
import { RELATED_ARTICLES_TIMEOUTS } from "./domain/related-articles/timeouts";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();
const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "info",
	callTimeoutMs: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: HutchLogger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const createMessage = initCreateDeepseekMessage({ client: deepseekClient });

const { selectRelatedArticles, selectPastReads } = initRelatedArticlesDepBundle({
	createMessage,
	nowMs: () => performance.now(),
	logger: consoleLogger,
});

const {
	findRelatedArticles,
	findRelatedCandidateArticles,
	findRelatedReadCandidateArticles,
	findRelatedTargetArticle,
	findSkippedNextReadSaves,
	markRelatedArticlesReady,
	markRelatedArticlesSkipped,
	replaceSkippedRelatedArticlesWithReady,
	replaceSkippedRelatedArticlesWithSkip,
} = initDynamoDbRelatedArticles({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const { findReadCandidatesAcrossReadlists, readPastReadsState, markPastReadsReady } =
	initDynamoDbPastReads({
		client: dynamoClient,
		tableName: articlesTable,
		userArticlesTableName: userArticlesTable,
	});

const { gatherRelatedCandidatePools } = initGatherRelatedCandidatePools({
	findRelatedCandidateArticles,
	findRelatedReadCandidateArticles,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const nextReadHandler = initComputeRelatedArticlesHandler({
	findRelatedArticles,
	findRelatedTargetArticle,
	gatherRelatedCandidatePools,
	selectRelatedArticles,
	markRelatedArticlesReady,
	markRelatedArticlesSkipped,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
});

const pastReadsHandler = initComputeRelatedPastReadsHandler({
	findRelatedTargetArticle,
	findReadCandidatesAcrossReadlists,
	readPastReadsState,
	selectPastReads,
	markPastReadsReady,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
});

const recomputeNextReadHandler = initRecomputeSkippedNextReadHandler({
	findRelatedTargetArticle,
	findSkippedNextReadSaves,
	gatherRelatedCandidatePools,
	selectRelatedArticles,
	replaceSkippedRelatedArticlesWithReady,
	replaceSkippedRelatedArticlesWithSkip,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
});

export const handler = initComputeRelatedPasses({
	nextReadHandler,
	pastReadsHandler,
	recomputeNextReadHandler,
});
