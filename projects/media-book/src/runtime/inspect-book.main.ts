import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { INSPECT_BOOK_ENV } from "./inspect-book.env";
import { initInspectBook } from "./inspect-book/inspect-book";
import { initInspectBookHandler } from "./inspect-book/inspect-book-handler";
import { initReadStagedRange } from "./s3/s3-staged-range";

const env = readEnv(INSPECT_BOOK_ENV);

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
const logger = Logger.from(consoleLogger);

export const handler = initInspectBookHandler({
	inspectBook: initInspectBook({
		readStagedRange: initReadStagedRange({ client: new S3Client({}), bucketName: env.MEDIA_BUCKET_NAME }),
		publishEvent,
		logger,
	}),
	logger,
});
