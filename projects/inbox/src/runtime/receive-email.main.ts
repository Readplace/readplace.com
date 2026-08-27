import { S3Client } from "@aws-sdk/client-s3";
import {
	assertCurlImpersonateAvailable,
	CRAWL_PERSONAS,
	defaultCurlImpersonateProbe,
	initCrawlFetch,
} from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { parseEmail } from "@packages/domain/inbox";
import { ConfirmGmailForwardingCommand } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { getEnv, requireEnv } from "@packages/require-env";
import { initDownloadEmailImages } from "./domain/inbox/download-email-images";
import { initInterceptGmailConfirmation } from "./domain/inbox/intercept-gmail-confirmation";
import { initReceiveEmailHandler } from "./domain/inbox/receive-email-handler";
import { initStoreEmailBody } from "./domain/inbox/store-email-body";
import { initS3PutImageObject } from "./providers/article-image/s3-put-image-object";
import { initDynamoDbInboxAddress, initDynamoDbInboxEmail, initS3ReadRawEmail, initS3WriteEmailContent } from "@packages/inbox-store";

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const inboxAddressesTable = requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE");
const rawEmailBucketName = requireEnv("RAW_EMAIL_BUCKET_NAME");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
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
// The same SSRF-guarded crawlFetch the link-preview crawler uses: every connect
// and redirect hop runs isBlockedIpAddress, so an image URL that resolves to a
// private or metadata address is refused at connect time.
const crawlFetch = initCrawlFetch({
	fetch: globalThis.fetch,
	personas: CRAWL_PERSONAS,
	isBlocked: isBlockedIpAddress,
	logInfo: (message) => logger.info(message),
	proxyUrl: undefined,
});
// Fail cold start loudly if the curl-impersonate binary is missing rather than
// let each image download that reaches the curl leg die on a per-URL ENOENT.
// Only in the deployed Lambda — dev/tests have no layer.
if (getEnv("AWS_LAMBDA_FUNCTION_NAME")) {
	assertCurlImpersonateAvailable({ probe: defaultCurlImpersonateProbe });
}
const { putImageObject } = initS3PutImageObject({ client: s3Client, bucketName: contentBucketName });
const storeBody = initStoreEmailBody({
	putContent: initS3WriteEmailContent({ client: s3Client, bucketName: contentBucketName }),
	putImageObject,
	imagesCdnBaseUrl,
	logger,
});

export const handler = initReceiveEmailHandler({
	readRawEmail: initS3ReadRawEmail({ client: s3Client, bucketName: rawEmailBucketName }),
	findByAddress: inboxAddressStore.findByAddress,
	putEmail: inboxEmailStore.putEmail,
	parseEmail,
	downloadEmailImages: initDownloadEmailImages({ crawlFetch, logger }),
	storeBody,
	publishEvent,
	interceptGmailConfirmation: initInterceptGmailConfirmation({
		publishConfirmGmailForwarding: (detail) => publishEvent(ConfirmGmailForwardingCommand, detail),
		logger,
	}),
	logger,
	maxEmailBytes,
});
