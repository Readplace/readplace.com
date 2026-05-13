import { SQSClient } from "@aws-sdk/client-sqs";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { GenerateSummaryCommand, SubmitLinkCommand } from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "../article-aggregate/lambda-effect-dispatcher";
import { initRecrawlLinkInitiatedDlqHandler } from "../crawl-article-state/recrawl-link-initiated-dlq-handler";
import { requireEnv } from "../require-env";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const submitLinkQueueUrl = requireEnv("SUBMIT_LINK_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});

const { store } = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
});

const { dispatch: dispatchGenerateSummary } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: generateSummaryQueueUrl,
	command: GenerateSummaryCommand,
});

const { dispatch: dispatchSubmitLink } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: submitLinkQueueUrl,
	command: SubmitLinkCommand,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { dispatchEffect } = initLambdaEffectDispatcher({
	dispatchGenerateSummary,
	dispatchSubmitLink,
	publishEvent,
});

const { transitionAndPersist } = initTransitionAndPersist({
	store,
	dispatchEffect,
});

export const handler = initRecrawlLinkInitiatedDlqHandler({
	transitionAndPersist,
	logger: consoleLogger,
});
