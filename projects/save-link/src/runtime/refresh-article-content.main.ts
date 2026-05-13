import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { initPutTierSource } from "./providers/article-store/put-tier-source";
import { requireEnv } from "../require-env";
import { initRefreshArticleContentHandler } from "./domain/save-link/refresh-article-content-handler";

const eventBusName = requireEnv("EVENT_BUS_NAME");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");

const s3Client = new S3Client({});

const { putTierSource } = initPutTierSource({
	client: s3Client,
	bucketName: contentBucketName,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initRefreshArticleContentHandler({
	putTierSource,
	publishEvent,
	logger: consoleLogger,
});
