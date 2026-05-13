/* c8 ignore start -- composition root, no logic to test */
import { S3Client } from "@aws-sdk/client-s3";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import { initResendEmail } from "./providers/email/resend-email";
import { initS3UserDataExport } from "./providers/user-data-export/s3-user-data-export";
import { initExportUserDataHandler } from "./export-user-data/export-user-data-handler";
import { requireEnv } from "./domain/require-env";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const exportBucketName = requireEnv("USER_EXPORT_BUCKET_NAME");
const resendApiKey = requireEnv("RESEND_API_KEY");

const dynamoClient = createDynamoDocumentClient();
const s3Client = new S3Client({});

const articleStore = initDynamoDbArticleStore({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const { uploadUserDataExport } = initS3UserDataExport({
	client: s3Client,
	bucketName: exportBucketName,
	now: () => new Date(),
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { sendEmail } = initResendEmail(resendApiKey);

export const handler = initExportUserDataHandler({
	findArticlesByUser: articleStore.findArticlesByUser,
	uploadUserDataExport,
	sendEmail,
	publishEvent,
	logger: HutchLogger.from(consoleLogger),
	now: () => new Date(),
});
/* c8 ignore stop */
