import { S3Client } from "@aws-sdk/client-s3";
import { initGmailRawCleanup } from "@packages/inbox-store";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { GMAIL_RAW_CLEANUP_ENV } from "./gmail-raw-cleanup.env";

const env = readEnv(GMAIL_RAW_CLEANUP_ENV);
const logger = Logger.from(consoleLogger);
const sweep = initGmailRawCleanup({
	s3: new S3Client({}), db: createDynamoDocumentClient(),
	bucketName: env.RAW_EMAIL_BUCKET_NAME, tableName: env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE,
	now: Date.now,
});

export const handler = async () => {
	const { deleted } = await sweep();
	logger.info("gmail-raw-cleanup-completed", { deleted });
};
