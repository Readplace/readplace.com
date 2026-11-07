import { S3Client } from "@aws-sdk/client-s3";
import {
	initDynamoDbFindItemOwner,
	initDynamoDbHighlightAnchors,
	initReadArticleContentOrThrow,
	initReadCanonicalSnapshot,
	initReadContentLocation,
	initS3ReadContent,
} from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initReanchorHighlightsHandler } from "./highlights/reanchor-highlights-handler";
import type { HighlightsReanchoredLine } from "./observability/events";
import { REANCHOR_HIGHLIGHTS_ENV } from "./reanchor-highlights.env";

const env = readEnv(REANCHOR_HIGHLIGHTS_ENV);

const articlesTable = env.DYNAMODB_ARTICLES_TABLE;
const contentBucketName = env.CONTENT_BUCKET_NAME;

const dynamoClient = createDynamoDocumentClient();
const s3 = new S3Client({});

const { listHighlightsOfArticle, writeHighlightAnchor } = initDynamoDbHighlightAnchors({
	client: dynamoClient,
	userArticlesTableName: env.DYNAMODB_USER_ARTICLES_TABLE,
});

const readArticleContent = initReadArticleContentOrThrow({
	storageProviderQueryOrder: [
		initS3ReadContent({
			send: (command) => s3.send(command),
			readContentLocation: initReadContentLocation({
				client: dynamoClient,
				tableName: articlesTable,
				bucketName: contentBucketName,
			}),
		}),
	],
	findItemOwner: initDynamoDbFindItemOwner({ client: dynamoClient, tableName: articlesTable }).findItemOwner,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

export const handler = initReanchorHighlightsHandler({
	listHighlightsOfArticle,
	readCanonicalSnapshot: initReadCanonicalSnapshot({ client: dynamoClient, tableName: articlesTable }),
	readArticleContent,
	writeHighlightAnchor,
	publishEvent,
	appOrigin: env.APP_ORIGIN,
	metricLog: Logger.fromJSON<HighlightsReanchoredLine>(),
	logger: Logger.from(consoleLogger),
});
