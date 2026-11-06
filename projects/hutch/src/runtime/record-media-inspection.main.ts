import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { readEnv } from "@packages/require-env";
import { RECORD_MEDIA_INSPECTION_ENV } from "./record-media-inspection.env";
import { initDynamoDbAnonymousMediaUpload } from "./providers/media-upload-session/dynamodb-anonymous-media-upload";
import { initRecordMediaInspectionHandler } from "./record-media-inspection/record-media-inspection-handler";

const env = readEnv(RECORD_MEDIA_INSPECTION_ENV);

const { recordMediaInspection } = initDynamoDbAnonymousMediaUpload({
	client: createDynamoDocumentClient(),
	tableName: env.DYNAMODB_MEDIA_UPLOAD_SESSIONS_TABLE,
	now: () => new Date(),
});

export const handler = initRecordMediaInspectionHandler({
	recordMediaInspection,
	logger: Logger.from(consoleLogger),
});
