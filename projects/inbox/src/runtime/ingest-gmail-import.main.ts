import { S3Client } from "@aws-sdk/client-s3";
import {
	assertCurlImpersonateAvailable,
	CRAWL_PERSONAS,
	defaultCurlImpersonateProbe,
	initCrawlFetch,
} from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { parseEmail } from "@packages/domain/inbox";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import {
	initDynamoDbEmailIdentity,
	initDynamoDbGmailHistoryImport,
	initDynamoDbInboxAddress,
	initDynamoDbInboxEmail,
	initS3ReadRawEmail,
	initS3WriteEmailContent,
} from "@packages/inbox-store";
import { getEnv, requireEnv } from "@packages/require-env";
import { initDownloadEmailImages } from "./domain/inbox/download-email-images";
import { initIngestGmailImportHandler } from "./domain/inbox/ingest-gmail-import-handler";
import { initIngestParsedEmail } from "./domain/inbox/ingest-parsed-email";
import { initResolveEmailIdentity } from "./domain/inbox/resolve-email-identity";
import { initStoreEmailBody } from "./domain/inbox/store-email-body";
import { initS3PutImageObject } from "./providers/article-image/s3-put-image-object";

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const inboxAddressesTable = requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE");
const emailIdentitiesTable = requireEnv("DYNAMODB_INBOX_EMAIL_IDENTITIES_TABLE");
const gmailHistoryImportsTable = requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE");
const rawEmailBucketName = requireEnv("RAW_EMAIL_BUCKET_NAME");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const maxEmailBytes = Number.parseInt(requireEnv("INBOX_MAX_EMAIL_BYTES"), 10);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const logger = HutchLogger.from(consoleLogger);
const now = () => new Date();

const inboxEmailStore = initDynamoDbInboxEmail({ client: dynamoClient, tableName: inboxEmailsTable });
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName });
const crawlFetch = initCrawlFetch({
	fetch: globalThis.fetch,
	personas: CRAWL_PERSONAS,
	isBlocked: isBlockedIpAddress,
	logInfo: (message) => logger.info(message),
	proxyUrl: undefined,
});
if (getEnv("AWS_LAMBDA_FUNCTION_NAME")) {
	assertCurlImpersonateAvailable({ probe: defaultCurlImpersonateProbe });
}
const { putImageObject } = initS3PutImageObject({ client: s3Client, bucketName: contentBucketName });

export const handler = initIngestGmailImportHandler({
	readRawEmail: initS3ReadRawEmail({ client: s3Client, bucketName: rawEmailBucketName }),
	parseEmail,
	findByAddress: initDynamoDbInboxAddress({ client: dynamoClient, tableName: inboxAddressesTable, now }).findByAddress,
	findImportJob: initDynamoDbGmailHistoryImport({ client: dynamoClient, tableName: gmailHistoryImportsTable }).findJob,
	downloadEmailImages: initDownloadEmailImages({ crawlFetch, logger }),
	resolveIdentity: initResolveEmailIdentity({
		identities: initDynamoDbEmailIdentity({ client: dynamoClient, tableName: emailIdentitiesTable }),
		findReceivedByMessageId: inboxEmailStore.findReceivedByMessageId,
		getEmail: inboxEmailStore.getEmail,
		now,
	}),
	ingest: initIngestParsedEmail({
		storeBody: initStoreEmailBody({
			putContent: initS3WriteEmailContent({ client: s3Client, bucketName: contentBucketName }),
			putImageObject,
			imagesCdnBaseUrl,
			logger,
		}),
		putEmail: inboxEmailStore.putEmail,
		publishEvent,
		logger,
	}),
	publishEvent,
	maxEmailBytes,
	logger,
});
