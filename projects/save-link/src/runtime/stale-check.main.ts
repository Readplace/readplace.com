import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
	SaveAnonymousLinkCommand,
	UpdateFetchTimestampCommand,
} from "@packages/hutch-infra-components";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import type {
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/test-fixtures/providers/events";
import { initStaleCheckHandler } from "./domain/stale-check/stale-check-handler";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleCrawlDepBundle } from "./dep-bundles/article-crawl";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initEmitSimpleCrawlUnsupported, initEventsDepBundle } from "./dep-bundles/events";
import { initEventBridgeRefreshArticleContent, initPutRefreshHtml } from "@packages/refresh-article-content";
import { initFindArticleCrawlStatus } from "./providers/article-crawl/find-article-crawl-status";
import { initFindArticleFreshness } from "./providers/article-crawl/find-article-freshness";
import { requireEnv } from "../require-env";

// 24h: mirrors hutch app.ts's staleTtlMs. Reads of an article older than this
// trigger a conditional GET against the source (304 → noop, 200 → re-extract).
const STALE_TTL_MS = 86_400_000;

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const pendingHtmlBucketName = requireEnv("PENDING_HTML_BUCKET_NAME");

const dynamoClient = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});
const s3Client = new S3Client({});
const now = () => new Date();

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
const parser = initParserDepBundle({ logError: observability.logError });
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });
const emitSimpleCrawlUnsupported = initEmitSimpleCrawlUnsupported({
	publishEvent: events.publishEvent,
});

const { putRefreshHtml } = initPutRefreshHtml({ client: s3Client, bucketName: pendingHtmlBucketName });
const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({
	publishEvent: events.publishEvent,
	putRefreshHtml,
});

const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = (params) =>
	events.publishEvent(UpdateFetchTimestampCommand, params);

const publishSaveAnonymousLink: PublishSaveAnonymousLink = (params) =>
	events.publishEvent(SaveAnonymousLinkCommand, params);

const { findArticleFreshness } = initFindArticleFreshness({
	client: dynamoClient,
	tableName: articlesTable,
});

const { findArticleCrawlStatus } = initFindArticleCrawlStatus({
	client: dynamoClient,
	tableName: articlesTable,
});

export const handler = initStaleCheckHandler({
	findArticleFreshness,
	findArticleCrawlStatus,
	simpleCrawl: parser.simpleCrawl,
	parseHtml: parser.parseHtml,
	publishRefreshArticleContent,
	publishUpdateFetchTimestamp,
	publishSaveAnonymousLink,
	emitSimpleCrawlUnsupported,
	markCrawlStage: articleCrawl.markCrawlStage,
	loadArticle: articleAggregate.store.load,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	now,
	staleTtlMs: STALE_TTL_MS,
	logger: consoleLogger,
});
