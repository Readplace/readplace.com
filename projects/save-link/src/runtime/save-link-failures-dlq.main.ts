import { SQSClient } from "@aws-sdk/client-sqs";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import {
	GenerateSummaryCommand,
	SAVE_LINK_DLQ_SOURCE_QUEUES,
} from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { requireEnv } from "@packages/require-env";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { initComprehensiveCrawlDlqHandler } from "./domain/comprehensive-crawl/comprehensive-crawl-dlq-handler";
import { initRecrawlLinkInitiatedDlqHandler } from "./domain/crawl-article-state/recrawl-link-initiated-dlq-handler";
import { initSaveAnonymousLinkDlqHandler } from "./domain/crawl-article-state/save-anonymous-link-dlq-handler";
import { initSaveLinkDlqHandler } from "./domain/crawl-article-state/save-link-dlq-handler";
import { initSaveLinkRawHtmlDlqHandler } from "./domain/crawl-article-state/save-link-raw-html-dlq-handler";
import { initSaveLinkRawPdfDlqHandler } from "./domain/crawl-article-state/save-link-raw-pdf-dlq-handler";
import { initGenerateSummaryDlqHandler } from "./domain/generate-summary/generate-summary-dlq-handler";
import { initReselectAfterRemovalDlqHandler } from "./domain/remove-my-content/reselect-after-removal-dlq-handler";
import { initRecrawlContentExtractedDlqHandler } from "./domain/select-content/recrawl-content-extracted-dlq-handler";
import { initSelectMostCompleteContentDlqHandler } from "./domain/select-content/select-most-complete-content-dlq-handler";
import { initSimpleCrawlUnsupportedPolicyDlqHandler } from "./domain/simple-crawl-unsupported-policy/simple-crawl-unsupported-policy-dlq-handler";
import { initSubmitLinkDlqHandler } from "./domain/submit-link/submit-link-dlq-handler";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

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

const { transitionAndPersist } = initTransitionAndPersist({
	store,
	dispatchEffect,
});

const logger = consoleLogger;

export const handler = initDeadLetterRouter({
	routes: {
		[SAVE_LINK_DLQ_SOURCE_QUEUES.saveLinkCommand]: initSaveLinkDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.submitLink]: initSubmitLinkDlqHandler({
			publishEvent,
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
				logger,
			}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.comprehensiveCrawlCommand]: initComprehensiveCrawlDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.saveLinkRawPdfCommand]: initSaveLinkRawPdfDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.selectMostCompleteContent]:
			initSelectMostCompleteContentDlqHandler({
				transitionAndPersist,
				logger,
			}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.reselectAfterRemoval]: initReselectAfterRemovalDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.generateSummary]: initGenerateSummaryDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.recrawlLinkInitiated]: initRecrawlLinkInitiatedDlqHandler({
			transitionAndPersist,
			logger,
		}),
		[SAVE_LINK_DLQ_SOURCE_QUEUES.recrawlContentExtracted]: initRecrawlContentExtractedDlqHandler({
			transitionAndPersist,
			logger,
		}),
	},
});
