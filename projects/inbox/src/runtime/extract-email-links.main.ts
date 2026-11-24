import assert from "node:assert";
import { S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	type DeepseekCallFailedLogLine,
	type DeepseekUsageLine,
	initCreateDeepseekMessage,
	initDeepseekClient,
} from "@packages/ai-message";
import { initDynamoDbReadlistDefinitions } from "@packages/article-store";
import {
	deriveSanitizedBody,
	EMAIL_LINK_ORDINAL_CAPACITY,
	parseEmail,
} from "@packages/domain/inbox";
import {
	CrawlEmailLinkPreview,
	EmailLinksTriagedEvent,
	EmailReceivedEvent,
	EmailOutputsSelectedEvent,
	SaveEmailIssueCommand,
	SendFirstInboxEmailNoticeCommand,
	SendTrialFeedbackEmailCommand,
	SubmitLinkCommand,
} from "@packages/infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import {
	initDynamoDbEmailImportCompletion,
	initDynamoDbInboxAddress,
	initDynamoDbInboxEmail,
	initDynamoDbInboxEmailLink,
	initS3ReadRawEmail,
} from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { EXTRACT_EMAIL_LINKS_ENV } from "./extract-email-links.env";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initExtractEmailLinksHandler } from "./domain/inbox/extract-email-links-handler";
import { initTriageEmailLinks } from "./domain/inbox/triage-email-links";

const env = readEnv(EXTRACT_EMAIL_LINKS_ENV);

const userArticlesTable = env.DYNAMODB_USER_ARTICLES_TABLE;
const inboxAddressesTable = env.DYNAMODB_INBOX_ADDRESSES_TABLE;
const inboxEmailsTable = env.DYNAMODB_INBOX_EMAILS_TABLE;
const inboxEmailLinksTable = env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE;
const rawEmailBucketName = env.RAW_EMAIL_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;
const recoveryQueueUrl = env.EXTRACT_LINKS_RECOVERY_QUEUE_URL;
const deepseekApiKey = env.DEEPSEEK_API_KEY;
const subscriptionProvidersTable = env.DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE;
const appOrigin = env.APP_ORIGIN;
const maxLinks = Number(env.INBOX_MAX_LINKS_PER_EMAIL);
assert(
	Number.isInteger(maxLinks) && maxLinks > 0 && maxLinks <= EMAIL_LINK_ORDINAL_CAPACITY,
	`INBOX_MAX_LINKS_PER_EMAIL (${maxLinks}) must be an integer from 1 to ${EMAIL_LINK_ORDINAL_CAPACITY} to fit EmailLinkOrdinalSchema`,
);

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const logger = Logger.from(consoleLogger);
const TRIAGE_DEEPSEEK_TIMEOUT_MS = 60_000;
const deepseekClient = initDeepseekClient({
	apiKey: deepseekApiKey,
	timeoutMs: TRIAGE_DEEPSEEK_TIMEOUT_MS,
	// The SDK would retry timeouts invisibly and stack attempts past the Lambda
	// budget; retrying is the triage loop's bounded, logged decision instead.
	maxRetries: 0,
	logger: consoleLogger,
	logLevel: "warn",
	callTimeoutMs: null,
	fetch: globalThis.fetch,
	logUsage: Logger.fromJSON<DeepseekUsageLine>().info,
	now: () => new Date(),
});
const createAiMessage = initCreateDeepseekMessage({ client: deepseekClient });
const { triageEmailLinks } = initTriageEmailLinks({
	createAiMessage,
	logger,
	deepseekCallFailedLog: Logger.fromJSON<DeepseekCallFailedLogLine>(),
});

const inboxAddressStore = initDynamoDbInboxAddress({
	client: dynamoClient,
	tableName: inboxAddressesTable,
	now: () => new Date(),
});
const inboxEmailStore = initDynamoDbInboxEmail({
	client: dynamoClient,
	tableName: inboxEmailsTable,
});
const emailImportCompletion = initDynamoDbEmailImportCompletion({
	client: dynamoClient,
	tableName: inboxEmailsTable,
});
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: inboxEmailLinksTable,
});
const { findByUserId } = initDynamoDbSubscriptionRead({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
});
const { publishEvent } = initEventBridgePublisher({
	client: eventBridgeClient,
	eventBusName,
});

export const handler = initExtractEmailLinksHandler({
	getEmail: inboxEmailStore.getEmail,
	readRawEmail: initS3ReadRawEmail({
		client: s3Client,
		bucketName: rawEmailBucketName,
	}),
	parseEmail,
	deriveSanitizedBody,
	putLink: inboxEmailLinkStore.putLink,
	getLink: inboxEmailLinkStore.getLink,
	putLinksMeta: inboxEmailLinkStore.putLinksMeta,
	findLinksMeta: inboxEmailLinkStore.findLinksMeta,
	markWindowDispatched: inboxEmailLinkStore.markWindowDispatched,
	setEmailLinkCounts: inboxEmailStore.setEmailLinkCounts,
	publishCrawlPreview: (input) => publishEvent(CrawlEmailLinkPreview, input),
	publishSubmitLink: (input) => publishEvent(SubmitLinkCommand, input),
	publishEmailLinksTriaged: (input) =>
		publishEvent(EmailLinksTriagedEvent, input),
	publishSaveEmailIssue: (input) => publishEvent(SaveEmailIssueCommand, input),
	findCompletion: emailImportCompletion.findCompletion,
	selectOutputs: emailImportCompletion.selectOutputs,
	amendSelection: emailImportCompletion.amendSelection,
	publishEmailOutputsSelected: (input) => publishEvent(EmailOutputsSelectedEvent, input),
	publishExtraction: (detail) => publishEvent(EmailReceivedEvent, detail),
	enqueueContinuation: async (detail) => {
		await sqsClient.send(new SendMessageCommand({
			QueueUrl: recoveryQueueUrl,
			MessageBody: JSON.stringify({ recovery: true, detail }),
		}));
	},
	publishSaveHeldNotice: ({ userId, receivedAtMessageId, inboxAddress }) =>
		publishEvent(SendTrialFeedbackEmailCommand, {
			userId,
			kind: "automation_saves_held",
			receivedAtMessageId,
			inboxAddress,
		}),
	publishFirstInboxEmailNotice: (input) =>
		publishEvent(SendFirstInboxEmailNoticeCommand, input),
	findSubscriptionByUserId: findByUserId,
	findInboxAddress: inboxAddressStore.findByAddress,
	listReadlistDefinitions: initDynamoDbReadlistDefinitions({
		client: dynamoClient,
		userArticlesTableName: userArticlesTable,
	}).listReadlistDefinitions,
	now: () => new Date(),
	triageEmailLinks,
	logger,
	maxLinks,
	appOrigin,
});
