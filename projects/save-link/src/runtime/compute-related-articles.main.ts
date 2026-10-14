import { initCreateDeepseekMessage } from "@packages/ai-message";
import { isSameArticle } from "@packages/domain/article";
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
import { initSelectAgreedPicks } from "./domain/related-articles/agreed-picks";
import { initComputeRelatedPasses } from "./domain/related-articles/compute-related-passes";
import { initComputeRelatedArticlesHandler } from "./domain/related-articles/compute-related-articles-handler";
import { initComputeRelatedPastReadsHandler } from "./domain/related-articles/compute-related-past-reads-handler";
import { initGatherRelatedCandidatePools } from "./domain/related-articles/related-articles-candidates";
import { NEXT_READ_SHARED_WORDS_FLOOR, PAST_READS_SHARED_WORDS_FLOOR } from "./domain/related-articles/related-articles-limits";
import { initSelectRelatedArticles } from "./domain/related-articles/related-articles-selector";
import { PAST_READS_PROMPT } from "./domain/related-articles/related-past-reads-prompt";
import { initSelectRelatedArticlesWithoutSharedBoilerplate } from "./domain/related-articles/shared-boilerplate";
import { initSelectRelatedArticlesAboveSharedWordsFloor } from "./domain/related-articles/shared-words-floor";
import { RELATED_ARTICLES_TIMEOUTS } from "./domain/related-articles/timeouts";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const dynamoClient = createDynamoDocumentClient();
const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
	maxRetries: 0,
});

const createMessage = initCreateDeepseekMessage({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params, {
		signal: AbortSignal.timeout(RELATED_ARTICLES_TIMEOUTS.deepseekMs),
	}),
});

const { selectRelatedArticles } = initSelectRelatedArticlesWithoutSharedBoilerplate(
	initSelectRelatedArticlesAboveSharedWordsFloor({
		...initSelectAgreedPicks(initSelectRelatedArticles({
			createMessage,
			nowMs: () => performance.now(),
			logger: consoleLogger,
		})),
		floor: NEXT_READ_SHARED_WORDS_FLOOR,
		countsTowardFloor: ({ target, candidate }) => !isSameArticle({
			article: { url: target.destinationUrl, title: target.title },
			other: { url: candidate.destinationUrl, title: candidate.title },
		}),
	}),
);

const { selectRelatedArticles: selectPastReads } =
	initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticlesAboveSharedWordsFloor({
			...initSelectRelatedArticles({
				createMessage,
				logger: consoleLogger,
				system: PAST_READS_PROMPT,
				nowMs: () => performance.now(),
			}),
			floor: PAST_READS_SHARED_WORDS_FLOOR,
			countsTowardFloor: () => true,
		}),
	);

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
