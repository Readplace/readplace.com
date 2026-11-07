import { initCanonicalAliasStore } from "@packages/article-store";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initResolveCandidateOriginal } from "./domain/select-content/resolve-candidate-original";
import { initPutTierSource } from "@packages/tier-source";
import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { consoleLogger } from "@packages/logger";
import { initReadRefreshHtml } from "./providers/refresh-html/read-refresh-html";
import { initFindRefreshAdmissionRow } from "./providers/article-crawl/find-refresh-admission-row";
import { readEnv } from "@packages/require-env";
import { REFRESH_ARTICLE_CONTENT_ENV } from "./refresh-article-content.env";
import { initRefreshArticleContentHandler } from "./domain/save-link/refresh-article-content-handler";

const env = readEnv(REFRESH_ARTICLE_CONTENT_ENV);

const eventBusName = env.EVENT_BUS_NAME;
const contentBucketName = env.CONTENT_BUCKET_NAME;
const pendingHtmlBucketName = env.PENDING_HTML_BUCKET_NAME;

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

const dynamoClient = createDynamoDocumentClient();

const { findRefreshAdmissionRow } = initFindRefreshAdmissionRow({ client: dynamoClient, tableName: env.DYNAMODB_ARTICLES_TABLE });

const canonicalAliasStore = initCanonicalAliasStore({ client: dynamoClient, tableName: env.DYNAMODB_ARTICLES_TABLE });
const resolveOriginalUrl = initResolveCandidateOriginal({ findIdentityRow: canonicalAliasStore.findIdentityRow });

export const handler = initRefreshArticleContentHandler({
	findRefreshAdmissionRow,
	resolveOriginalUrl,
	readRefreshHtml,
	putTierSource,
	publishEvent,
	logger: consoleLogger,
});
