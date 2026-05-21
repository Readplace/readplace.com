import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { initPutTierSource } from "./providers/article-store/put-tier-source";
import { initReadRefreshHtml } from "./providers/refresh-html/read-refresh-html";
import { requireEnv } from "../require-env";
import { initRefreshArticleContentHandler } from "./domain/save-link/refresh-article-content-handler";

const eventBusName = requireEnv("EVENT_BUS_NAME");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const pendingHtmlBucketName = requireEnv("PENDING_HTML_BUCKET_NAME");

const s3Client = new S3Client({});

const { putTierSource } = initPutTierSource({
	client: s3Client,
	bucketName: contentBucketName,
});

const { readRefreshHtml } = initReadRefreshHtml({
	client: s3Client,
	bucketName: pendingHtmlBucketName,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initRefreshArticleContentHandler({
	readRefreshHtml,
	putTierSource,
	publishEvent,
	logger: consoleLogger,
});
