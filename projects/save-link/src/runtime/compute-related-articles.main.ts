import type {
	Handler,
	SQSBatchResponse,
	SQSEvent,
	SQSRecord,
} from "aws-lambda";
import { initCreateDeepseekMessage } from "@packages/ai-message";
import {
	initDynamoDbPastReads,
	initDynamoDbRelatedArticles,
} from "@packages/article-store";
import {
	ComputeRelatedPastReadsCommand,
	QueueEntryCreatedEvent,
} from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import OpenAI from "openai";
import { initComputeRelatedArticlesHandler } from "./domain/related-articles/compute-related-articles-handler";
import { initComputeRelatedPastReadsHandler } from "./domain/related-articles/compute-related-past-reads-handler";
import { initGatherRelatedCandidatePools } from "./domain/related-articles/related-articles-candidates";
import { initSelectRelatedArticles } from "./domain/related-articles/related-articles-selector";
import { PAST_READS_PROMPT } from "./domain/related-articles/related-past-reads-prompt";
import { initSelectRelatedArticlesWithoutSharedBoilerplate } from "./domain/related-articles/shared-boilerplate";
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
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

const { selectRelatedArticles } = initSelectRelatedArticlesWithoutSharedBoilerplate(
	initSelectRelatedArticles({
		createMessage,
		logger: consoleLogger,
	}),
);

const { selectRelatedArticles: selectPastReads } =
	initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticles({
			createMessage,
			logger: consoleLogger,
			system: PAST_READS_PROMPT,
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

const detailTypeOf = (record: SQSRecord): unknown =>
	JSON.parse(record.body)["detail-type"];

// One queue feeds both computations. A new save (QueueEntryCreated) precomputes
// Next read AND, independently, the past-reads topic section; the explicit
// ComputeRelatedPastReads command re-runs only the past-reads section for an
// existing or stale save. A record that fails either pass is retried whole; both
// passes are idempotent (Next read is terminal-once, past reads is
// fingerprint-guarded), so re-running the succeeded pass is a no-op.
export const handler: Handler<SQSEvent, SQSBatchResponse> = async (
	event,
	context,
	callback,
) => {
	const nextReadRecords = event.Records.filter(
		(record) => detailTypeOf(record) === QueueEntryCreatedEvent.detailType,
	);
	const pastReadsRecords = event.Records.filter((record) => {
		const detailType = detailTypeOf(record);
		return (
			detailType === QueueEntryCreatedEvent.detailType ||
			detailType === ComputeRelatedPastReadsCommand.detailType
		);
	});

	const failed = new Set<string>();
	const nextRead = await nextReadHandler(
		{ ...event, Records: nextReadRecords },
		context,
		callback,
	);
	for (const failure of nextRead?.batchItemFailures ?? [])
		failed.add(failure.itemIdentifier);
	const pastReads = await pastReadsHandler(
		{ ...event, Records: pastReadsRecords },
		context,
		callback,
	);
	for (const failure of pastReads?.batchItemFailures ?? [])
		failed.add(failure.itemIdentifier);

	return { batchItemFailures: [...failed].map((itemIdentifier) => ({ itemIdentifier })) };
};
