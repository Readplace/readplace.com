import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekMessage, initDeepseekClient } from "@packages/ai-message";
import {
	initDynamoDbPastReads,
	initDynamoDbRelatedArticles,
} from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { requireEnv } from "@packages/require-env";
import { initRelatedArticlesDepBundle } from "./dep-bundles/related-articles";
import { initDynamoDbRecommendationBudget } from "./providers/recommendation-budget/dynamodb-recommendation-budget";
import type { RecommendationBudgetDeniedLine } from "./domain/related-articles/daily-budget";
import { initDeepseekFlashTokenCounter } from "./domain/related-articles/deepseek-flash-tokenizer/deepseek-flash-tokenizer";
import {
	RECOMMENDATION_BUDGET_WINDOW_SECONDS,
	RECOMMENDATION_DAILY_LIMIT_NANODOLLARS,
} from "./domain/related-articles/recommendation-budget";
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
const rateLimitsTable = requireEnv("DYNAMODB_RATE_LIMITS_TABLE");

const dynamoClient = createDynamoDocumentClient();
const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "info",
	callTimeoutMs: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const createMessage = initCreateDeepseekMessage({ client: deepseekClient });

const budget = initDynamoDbRecommendationBudget({
	client: dynamoClient,
	tableName: rateLimitsTable,
	limitNanodollars: RECOMMENDATION_DAILY_LIMIT_NANODOLLARS,
	windowSeconds: RECOMMENDATION_BUDGET_WINDOW_SECONDS,
	now: () => new Date(),
	delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const { countPromptTokens } = initDeepseekFlashTokenCounter();

const { selectRelatedArticles, selectPastReads } = initRelatedArticlesDepBundle({
	createMessage,
	nowMs: () => performance.now(),
	logger: consoleLogger,
	budget,
	countPromptTokens,
	budgetDeniedLog: Logger.fromJSON<RecommendationBudgetDeniedLine>(),
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

const { findReadCandidatesAcrossReadlists, readPastReadsState, markPastReadsReady, markPastReadsBudgetBlocked } =
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
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
});

const pastReadsHandler = initComputeRelatedPastReadsHandler({
	findRelatedTargetArticle,
	findReadCandidatesAcrossReadlists,
	readPastReadsState,
	selectPastReads,
	markPastReadsReady,
	markPastReadsBudgetBlocked,
	publishEvent,
	now: () => new Date(),
	logger: consoleLogger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
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
