import assert from "node:assert";
import { S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { initCreateDeepseekMessage } from "@packages/ai-message";
import { deriveSanitizedBody, EMAIL_LINK_ORDINAL_CAPACITY, parseEmail } from "@packages/domain/inbox";
import {
	CrawlEmailLinkPreview,
	SendTrialFeedbackEmailCommand,
	SubmitLinkCommand,
} from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import OpenAI from "openai";
import { initExtractEmailLinksHandler } from "./domain/inbox/extract-email-links-handler";
import { initTriageEmailLinks } from "./domain/inbox/triage-email-links";
import { initDynamoDbInboxEmail, initDynamoDbInboxEmailLink, initS3ReadRawEmail } from "@packages/inbox-store";

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
const rawEmailBucketName = requireEnv("RAW_EMAIL_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const truncationAlertQueueUrl = requireEnv("EXTRACT_LINKS_TRUNCATION_ALERT_QUEUE_URL");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
const maxLinks = Number.parseInt(requireEnv("INBOX_MAX_LINKS_PER_EMAIL"), 10);
assert(
	maxLinks <= EMAIL_LINK_ORDINAL_CAPACITY,
	`INBOX_MAX_LINKS_PER_EMAIL (${maxLinks}) exceeds the email link ordinal capacity (${EMAIL_LINK_ORDINAL_CAPACITY}); a higher cap would mint ordinals too wide for EmailLinkOrdinalSchema to parse`,
);

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const logger = HutchLogger.from(consoleLogger);
const TRIAGE_DEEPSEEK_TIMEOUT_MS = 60_000;
const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: TRIAGE_DEEPSEEK_TIMEOUT_MS,
	// The SDK would retry timeouts invisibly and stack attempts past the Lambda
	// budget; retrying is the triage loop's bounded, logged decision instead.
	maxRetries: 0,
});
const createAiMessage = initCreateDeepseekMessage({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});
const { triageEmailLinks } = initTriageEmailLinks({ createAiMessage, logger });

const inboxEmailStore = initDynamoDbInboxEmail({ client: dynamoClient, tableName: inboxEmailsTable });
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: inboxEmailLinksTable,
});
const { findByUserId } = initDynamoDbSubscriptionRead({
	client: dynamoClient,
	tableName: subscriptionProvidersTable,
});
const { publishEvent } = initEventBridgePublisher({ client: eventBridgeClient, eventBusName });

export const handler = initExtractEmailLinksHandler({
	getEmail: inboxEmailStore.getEmail,
	readRawEmail: initS3ReadRawEmail({ client: s3Client, bucketName: rawEmailBucketName }),
	parseEmail,
	deriveSanitizedBody,
	putLink: inboxEmailLinkStore.putLink,
	getLink: inboxEmailLinkStore.getLink,
	putLinksMeta: inboxEmailLinkStore.putLinksMeta,
	setEmailLinkCounts: inboxEmailStore.setEmailLinkCounts,
	publishCrawlPreview: (input) => publishEvent(CrawlEmailLinkPreview, input),
	publishSubmitLink: (input) => publishEvent(SubmitLinkCommand, input),
	alertTruncated: async (input) => {
		// Dedicated alert queue, not the failure DLQ: truncation is a successful
		// degradation, so its send-rate alarm is a distinct signal from genuine faults.
		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: truncationAlertQueueUrl,
				MessageBody: JSON.stringify({ reason: "inbox-link-cap-truncated", ...input }),
			}),
		);
	},
	publishSaveHeldNotice: ({ userId, receivedAtMessageId }) =>
		publishEvent(SendTrialFeedbackEmailCommand, {
			userId,
			kind: "automation_saves_held",
			receivedAtMessageId,
		}),
	findSubscriptionByUserId: findByUserId,
	now: () => new Date(),
	triageEmailLinks,
	logger,
	maxLinks,
});
