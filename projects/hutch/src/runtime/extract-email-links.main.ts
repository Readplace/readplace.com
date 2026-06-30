import { S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { deriveSanitizedBody, parseEmail } from "@packages/domain/inbox";
import { CrawlEmailLinkPreview } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initExtractEmailLinksHandler } from "./domain/inbox/extract-email-links-handler";
import { initDynamoDbInboxEmail } from "./providers/inbox-email/dynamodb-inbox-email";
import { initDynamoDbInboxEmailLink } from "./providers/inbox-email/dynamodb-inbox-email-link";
import { initS3ReadRawEmail } from "./providers/inbox-email/s3-read-raw-email";

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
const rawEmailBucketName = requireEnv("RAW_EMAIL_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const truncationAlertQueueUrl = requireEnv("EXTRACT_LINKS_TRUNCATION_ALERT_QUEUE_URL");
const maxLinks = Number.parseInt(requireEnv("INBOX_MAX_LINKS_PER_EMAIL"), 10);

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const logger = HutchLogger.from(consoleLogger);

const inboxEmailStore = initDynamoDbInboxEmail({ client: dynamoClient, tableName: inboxEmailsTable });
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: inboxEmailLinksTable,
});
const { publishEvent } = initEventBridgePublisher({ client: eventBridgeClient, eventBusName });

export const handler = initExtractEmailLinksHandler({
	getEmail: inboxEmailStore.getEmail,
	readRawEmail: initS3ReadRawEmail({ client: s3Client, bucketName: rawEmailBucketName }),
	parseEmail,
	deriveSanitizedBody,
	putLink: inboxEmailLinkStore.putLink,
	putLinksMeta: inboxEmailLinkStore.putLinksMeta,
	publishCrawlPreview: (input) => publishEvent(CrawlEmailLinkPreview, input),
	alertTruncated: async (input) => {
		// Dedicated alert queue, not the failure DLQ: truncation is a successful
		// degradation, so its depth alarm is a distinct signal from genuine faults.
		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: truncationAlertQueueUrl,
				MessageBody: JSON.stringify({ reason: "inbox-link-cap-truncated", ...input }),
			}),
		);
	},
	logger,
	maxLinks,
});
