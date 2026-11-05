import { initDynamoDbPrivateItem } from "@packages/article-store";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbMediaUploadSessions } from "./providers/media-upload-session/dynamodb-media-upload-sessions";
import { initSettleMediaFailureHandler } from "./settle-media-failure/settle-media-failure-handler";

const dynamoClient = createDynamoDocumentClient();

const { recordPrivateItemFailure } = initDynamoDbPrivateItem({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_ARTICLES_TABLE"),
	userArticlesTableName: requireEnv("DYNAMODB_USER_ARTICLES_TABLE"),
});

const { failMediaUpload } = initDynamoDbMediaUploadSessions({
	client: dynamoClient,
	tableName: requireEnv("DYNAMODB_MEDIA_UPLOAD_SESSIONS_TABLE"),
	now: () => new Date(),
});

export const handler = initSettleMediaFailureHandler({
	recordPrivateItemFailure,
	failMediaUpload,
	logger: HutchLogger.from(consoleLogger),
});
