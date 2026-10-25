import { initCreateDeepseekMessage } from "@packages/ai-message";
import {
	initDynamoDbPastReads,
	initDynamoDbRelatedArticles,
} from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import OpenAI from "openai";
import { initDeepseekChatCompletion } from "./providers/deepseek/deepseek-chat-completion";
import { initRelatedArticlesDepBundle } from "./dep-bundles/related-articles";
import { initComputeRelatedPasses } from "./domain/related-articles/compute-related-passes";
import { initComputeRelatedArticlesHandler } from "./domain/related-articles/compute-related-articles-handler";
import { initComputeRelatedPastReadsHandler } from "./domain/related-articles/compute-related-past-reads-handler";
import { initGatherRelatedCandidatePools } from "./domain/related-articles/related-articles-candidates";
import { RELATED_ARTICLES_TIMEOUTS } from "./domain/related-articles/timeouts";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();
const { createChatCompletion } = initDeepseekChatCompletion({
	apiKey: deepseekApiKey,
	timeoutMs: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
	logger: consoleLogger,
	newClient: (options) => new OpenAI(options),
});

const createMessage = initCreateDeepseekMessage({
	createChatCompletion,
});

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
	markRelatedArticlesReady,
	markRelatedArticlesSkipped,
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

export const handler = initComputeRelatedPasses({ nextReadHandler, pastReadsHandler });
