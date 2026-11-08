import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { type DeepseekCallFailedLogLine, type DeepseekUsageLine, initCreateDeepseekChatCompletion, initDeepseekClient } from "@packages/ai-message";
import { EventBridgeClient } from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { type CrawlSettledEvent, initLogCrawlSettled } from "@packages/infra-components";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initForwardRefreshContentExtracted, initRefreshContentExtractedHandler } from "./domain/select-content/refresh-content-extracted-handler";
import { SELECTION_INGRESS_ENV, SelectionRouteSchema } from "./selection-ingress.env";
import { initSelectArticleContentDispatch } from "./dep-bundles/select-article-content-dispatch";
import { SELECT_CONTENT_TIMEOUTS } from "./domain/select-content/timeouts";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initSelectContentDepBundle } from "./dep-bundles/select-content";
import { readEnv } from "@packages/require-env";
import { REFRESH_CONTENT_EXTRACTED_ENV } from "./refresh-content-extracted.env";

const env = readEnv(REFRESH_CONTENT_EXTRACTED_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;
const deepseekApiKey = env.DEEPSEEK_API_KEY;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;

const ingressEnv = readEnv(SELECTION_INGRESS_ENV);
const selectionRoute = SelectionRouteSchema.parse(ingressEnv.SELECTION_ROUTE);
const selectArticleContentQueueUrl = ingressEnv.SELECT_ARTICLE_CONTENT_QUEUE_URL;

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});
const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: SELECT_CONTENT_TIMEOUTS.deepseekMs,
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "info",
	callTimeoutMs: SELECT_CONTENT_TIMEOUTS.deepseekMs,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});

const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const { logCrawlSettled } = initLogCrawlSettled({ logger: Logger.fromJSON<CrawlSettledEvent>(), now: () => new Date() });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events, logCrawlSettled });
const selectContent = initSelectContentDepBundle({
	s3Client,
	dynamoClient,
	contentBucketName,
	articlesTable,
	createChatCompletion: initCreateDeepseekChatCompletion({ client: deepseekClient }),
	logger: consoleLogger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
	now: () => new Date(),
});

const selectHandler = initRefreshContentExtractedHandler({
	...selectContent,
	...articleAggregate,
	loadArticle: articleAggregate.store.load,
	now: () => new Date(),
	logger: consoleLogger,
});

export const handler = selectionRoute === "forward"
	? initForwardRefreshContentExtracted({ dispatchSelectArticleContent: initSelectArticleContentDispatch({ sqsClient, selectArticleContentQueueUrl }), logger: consoleLogger })
	: selectHandler;
