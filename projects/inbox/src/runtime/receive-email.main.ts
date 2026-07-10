import { S3Client } from "@aws-sdk/client-s3";
import { parseEmail } from "@packages/domain/inbox";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initReceiveEmailHandler } from "./domain/inbox/receive-email-handler";
import { initStoreEmailBody } from "./domain/inbox/store-email-body";
import { initDynamoDbInboxAddress, initDynamoDbInboxEmail, initS3ReadRawEmail, initS3WriteEmailContent } from "@packages/inbox-store";

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const inboxAddressesTable = requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE");
const rawEmailBucketName = requireEnv("RAW_EMAIL_BUCKET_NAME");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const maxEmailBytes = Number.parseInt(requireEnv("INBOX_MAX_EMAIL_BYTES"), 10);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const logger = HutchLogger.from(consoleLogger);

const inboxAddressStore = initDynamoDbInboxAddress({
	client: dynamoClient,
	tableName: inboxAddressesTable,
	now: () => new Date(),
});
const inboxEmailStore = initDynamoDbInboxEmail({ client: dynamoClient, tableName: inboxEmailsTable });
const { publishEvent } = initEventBridgePublisher({ client: eventBridgeClient, eventBusName });
const storeBody = initStoreEmailBody({
	putContent: initS3WriteEmailContent({ client: s3Client, bucketName: contentBucketName }),
});

export const handler = initReceiveEmailHandler({
	readRawEmail: initS3ReadRawEmail({ client: s3Client, bucketName: rawEmailBucketName }),
	findByAddress: inboxAddressStore.findByAddress,
	putEmail: inboxEmailStore.putEmail,
	parseEmail,
	storeBody,
	publishEvent,
	logger,
	maxEmailBytes,
});
