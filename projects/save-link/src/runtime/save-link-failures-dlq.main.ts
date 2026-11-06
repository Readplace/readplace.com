import { SQSClient } from "@aws-sdk/client-sqs";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import {
	GenerateSummaryCommand,
	SAVE_LINK_DLQ_SOURCE_QUEUES,
	type CrawlSettledEvent,
	initLogCrawlSettled,
} from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { readEnv } from "@packages/require-env";
import { SAVE_LINK_FAILURES_DLQ_ENV } from "./save-link-failures-dlq.env";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { initComprehensiveCrawlDlqHandler } from "./domain/comprehensive-crawl/comprehensive-crawl-dlq-handler";
import { initRenderCrawlDlqHandler } from "./domain/render-crawl/render-crawl-dlq-handler";
import { initRecrawlLinkInitiatedDlqHandler } from "./domain/crawl-article-state/recrawl-link-initiated-dlq-handler";
import { initSaveAnonymousLinkDlqHandler } from "./domain/crawl-article-state/save-anonymous-link-dlq-handler";
import { initSaveLinkDlqHandler } from "./domain/crawl-article-state/save-link-dlq-handler";
import { initSaveLinkRawHtmlDlqHandler } from "./domain/crawl-article-state/save-link-raw-html-dlq-handler";
import { initSaveLinkRawPdfDlqHandler } from "./domain/crawl-article-state/save-link-raw-pdf-dlq-handler";
import { initSimpleCrawlUnsupportedPolicyDlqHandler } from "./domain/simple-crawl-unsupported-policy/simple-crawl-unsupported-policy-dlq-handler";
import { initSubmitLinkDlqHandler } from "./domain/submit-link/submit-link-dlq-handler";

const env = readEnv(SAVE_LINK_FAILURES_DLQ_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const eventBusName = env.EVENT_BUS_NAME;
const generateSummaryQueueUrl = env.GENERATE_SUMMARY_QUEUE_URL;

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

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { dispatchEffect } = initLambdaEffectDispatcher({
	dispatchGenerateSummary,
	publishEvent,
});

const { logCrawlSettled } = initLogCrawlSettled({ logger: Logger.fromJSON<CrawlSettledEvent>(), now: () => new Date() });
const { transitionAndPersist } = initTransitionAndPersist({
	store,
	dispatchEffect,
	logCrawlSettled,
});

const logger = consoleLogger;
const now = () => new Date();

export const handler = initDeadLetterRouter({
	routes: {
		[SAVE_LINK_DLQ_SOURCE_QUEUES.saveLinkCommand]: initSaveLinkDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.submitLink]: initSubmitLinkDlqHandler({
			publishEvent,
			loadArticle: store.load,
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.saveLinkRawHtmlCommand]: initSaveLinkRawHtmlDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.saveAnonymousLinkCommand]: initSaveAnonymousLinkDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.simpleCrawlUnsupportedPolicy]:
			initSimpleCrawlUnsupportedPolicyDlqHandler({
				transitionAndPersist,
				publishEvent,
				logger,
				now,
			}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.comprehensiveCrawlCommand]: initComprehensiveCrawlDlqHandler({
			transitionAndPersist,
			publishEvent,
			logger,
			now,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.renderCrawlCommand]: initRenderCrawlDlqHandler({
			transitionAndPersist,
			publishEvent,
			logger,
			now,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.saveLinkRawPdfCommand]: initSaveLinkRawPdfDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.recrawlLinkInitiated]: initRecrawlLinkInitiatedDlqHandler({
			transitionAndPersist,
			logger,
		}),
	},
});
