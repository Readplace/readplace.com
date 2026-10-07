import { initCanonicalAliasStore } from "@packages/article-store";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initResolveCandidateOriginal } from "./domain/select-content/candidate-provenance";
import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { initPutTierSource } from "./providers/article-store/put-tier-source";
import { initReadRefreshHtml } from "./providers/refresh-html/read-refresh-html";
import { requireEnv } from "@packages/require-env";
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

const canonicalAliasStore = initCanonicalAliasStore({ client: createDynamoDocumentClient(), tableName: requireEnv("DYNAMODB_ARTICLES_TABLE") });
const resolveOriginalUrl = initResolveCandidateOriginal({ findIdentityRow: canonicalAliasStore.findIdentityRow });

export const handler = initRefreshArticleContentHandler({
	resolveOriginalUrl,
	readRefreshHtml,
	putTierSource,
	publishEvent,
	logger: consoleLogger,
});
