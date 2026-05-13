import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "../require-env";
import { initSelectMostCompleteContentDlqHandler } from "../select-content/select-most-complete-content-dlq-handler";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initEventsDepBundle } from "./dep-bundles/events";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const submitLinkQueueUrl = requireEnv("SUBMIT_LINK_QUEUE_URL");

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});

const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl, submitLinkQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });

export const handler = initSelectMostCompleteContentDlqHandler({
	...articleAggregate,
	logger: consoleLogger,
});
