import { initDynamoDbPrivateItem } from "@packages/article-store";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { SETTLE_MEDIA_FAILURE_ENV } from "./settle-media-failure.env";
import { initDynamoDbMediaUploadSessions } from "./providers/media-upload-session/dynamodb-media-upload-sessions";
import { initSettleMediaFailureHandler } from "./settle-media-failure/settle-media-failure-handler";

const env = readEnv(SETTLE_MEDIA_FAILURE_ENV);

const dynamoClient = createDynamoDocumentClient();

const { recordPrivateItemFailure } = initDynamoDbPrivateItem({
	client: dynamoClient,
	tableName: env.DYNAMODB_ARTICLES_TABLE,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
});

const { failMediaUpload } = initDynamoDbMediaUploadSessions({
	client: dynamoClient,
	tableName: env.DYNAMODB_MEDIA_UPLOAD_SESSIONS_TABLE,
	now: () => new Date(),
});

export const handler = initSettleMediaFailureHandler({
	recordPrivateItemFailure,
	failMediaUpload,
	logger: Logger.from(consoleLogger),
});
