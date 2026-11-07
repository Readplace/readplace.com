import { initResumeAcceptedGmailEmail } from "./domain/inbox/resume-accepted-gmail-email";
import { S3Client } from "@aws-sdk/client-s3";
import {
	assertCurlImpersonateAvailable,
	CRAWL_PERSONAS,
	defaultCurlImpersonateProbe,
	initCrawlFetch,
} from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { parseEmail } from "@packages/domain/inbox";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import {
	initDynamoDbEmailIdentity,
	initDynamoDbEmailImportCompletion,
	initDynamoDbGmailHistoryImport,
	initDynamoDbInboxAddress,
	initDynamoDbInboxEmail,
	initS3DeleteObjects,
	initS3ReadRawEmail,
	initS3WriteEmailContent,
} from "@packages/inbox-store";
import { getEnv, readEnv } from "@packages/require-env";
import { INGEST_GMAIL_IMPORT_ENV } from "./ingest-gmail-import.env";
import { initEvaluateGmailImportCompletion } from "./domain/gmail-import-completion/evaluate-gmail-import-completion";
import { initRecordDuplicateGmailOrigin } from "./domain/gmail-import-completion/record-gmail-origin";
import { initDownloadEmailImages } from "./domain/inbox/download-email-images";
import { initIngestGmailImportHandler } from "./domain/inbox/ingest-gmail-import-handler";
import { initIngestParsedEmail } from "./domain/inbox/ingest-parsed-email";
import { initResolveEmailIdentity } from "./domain/inbox/resolve-email-identity";
import { initStoreEmailBody } from "./domain/inbox/store-email-body";
import { initS3PutImageObject } from "./providers/article-image/s3-put-image-object";

const env = readEnv(INGEST_GMAIL_IMPORT_ENV);

const inboxEmailsTable = env.DYNAMODB_INBOX_EMAILS_TABLE;
const inboxAddressesTable = env.DYNAMODB_INBOX_ADDRESSES_TABLE;
const emailIdentitiesTable = env.DYNAMODB_INBOX_EMAIL_IDENTITIES_TABLE;
const gmailHistoryImportsTable = env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE;
const rawEmailBucketName = env.RAW_EMAIL_BUCKET_NAME;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const eventBusName = env.EVENT_BUS_NAME;
const imagesCdnBaseUrl = env.IMAGES_CDN_BASE_URL;
const maxEmailBytes = Number.parseInt(env.INBOX_MAX_EMAIL_BYTES, 10);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const logger = Logger.from(consoleLogger);
const now = () => new Date();

const inboxEmailStore = initDynamoDbInboxEmail({
	client: dynamoClient,
	tableName: inboxEmailsTable,
});
const emailImportCompletion = initDynamoDbEmailImportCompletion({
	client: dynamoClient,
	tableName: inboxEmailsTable,
});
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});
const crawlFetch = initCrawlFetch({
	fetch: globalThis.fetch,
	personas: CRAWL_PERSONAS,
	isBlocked: isBlockedIpAddress,
	logInfo: (message) => logger.info(message),
	egress: { kind: "direct" },
});
if (getEnv("AWS_LAMBDA_FUNCTION_NAME")) {
	assertCurlImpersonateAvailable({ probe: defaultCurlImpersonateProbe });
}
const { putImageObject } = initS3PutImageObject({
	client: s3Client,
	bucketName: contentBucketName,
});

export const handler = initIngestGmailImportHandler({
	resumeAcceptedGmailEmail: initResumeAcceptedGmailEmail({
		getEmail: inboxEmailStore.getEmail,
		addGmailOrigins: emailImportCompletion.addGmailOrigins,
		publishEvent,
	}),
	recordDuplicateGmailOrigin: initRecordDuplicateGmailOrigin({
		addGmailOrigins: emailImportCompletion.addGmailOrigins,
		evaluate: initEvaluateGmailImportCompletion({
			findCompletion: emailImportCompletion.findCompletion,
			publishEvent,
		}),
	}),
	readRawEmail: initS3ReadRawEmail({
		client: s3Client,
		bucketName: rawEmailBucketName,
	}),
	deleteRawEmail: (s3Key) => initS3DeleteObjects({ client: s3Client, bucketName: rawEmailBucketName })([s3Key]),
	parseEmail,
	findByAddress: initDynamoDbInboxAddress({
		client: dynamoClient,
		tableName: inboxAddressesTable,
		now,
	}).findByAddress,
	findImportJob: initDynamoDbGmailHistoryImport({
		client: dynamoClient,
		tableName: gmailHistoryImportsTable,
	}).findJob,
	downloadEmailImages: initDownloadEmailImages({ crawlFetch, logger }),
	resolveIdentity: initResolveEmailIdentity({
		identities: initDynamoDbEmailIdentity({
			client: dynamoClient,
			tableName: emailIdentitiesTable,
		}),
		findReceivedByMessageId: inboxEmailStore.findReceivedByMessageId,
		getEmail: inboxEmailStore.getEmail,
		now,
	}),
	ingest: initIngestParsedEmail({
		storeBody: initStoreEmailBody({
			putContent: initS3WriteEmailContent({
				client: s3Client,
				bucketName: contentBucketName,
			}),
			putImageObject,
			imagesCdnBaseUrl,
			logger,
		}),
		putEmail: inboxEmailStore.putEmail,
		getEmail: inboxEmailStore.getEmail,
		addGmailOrigins: emailImportCompletion.addGmailOrigins,
		publishEvent,
		logger,
	}),
	publishEvent,
	maxEmailBytes,
	logger,
});
