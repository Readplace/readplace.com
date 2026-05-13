import { SQSClient } from "@aws-sdk/client-sqs";
import { DEFAULT_CRAWL_HEADERS, initCrawlArticle, initCrawlFetch } from "@packages/crawl-article";
import {
	RefreshArticleContentCommand,
	SaveAnonymousLinkCommand,
	UpdateFetchTimestampCommand,
} from "@packages/hutch-infra-components";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initRefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type {
	PublishRefreshArticleContent,
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/test-fixtures/providers/events";
import { initReadabilityParser } from "../article-parser/readability-parser";
import { theInformationPreParser } from "../article-parser/the-information-pre-parser";
import { initFindArticleCrawlStatus } from "../crawl-article-state/find-article-crawl-status";
import { initFindArticleFreshness } from "../crawl-article-state/find-article-freshness";
import { requireEnv } from "../require-env";
import { initStaleCheckHandler } from "../save-link/stale-check-handler";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initEventsDepBundle } from "./dep-bundles/events";

// 24h: mirrors hutch app.ts's staleTtlMs. Reads of an article older than this
// trigger a conditional GET against the source (304 → noop, 200 → re-extract).
const STALE_TTL_MS = 86_400_000;

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const submitLinkQueueUrl = requireEnv("SUBMIT_LINK_QUEUE_URL");

const client = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const eventBridgeClient = new EventBridgeClient({});
const logError = (message: string, error?: Error) =>
	consoleLogger.error(message, { error });

const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, defaultHeaders: { ...DEFAULT_CRAWL_HEADERS } });
const crawlArticle = initCrawlArticle({ crawlFetch, logError });

const { parseHtml } = initReadabilityParser({
	crawlArticle,
	sitePreParsers: [theInformationPreParser],
	logError,
});

const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl, submitLinkQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient: client, articlesTable, events });

const publishRefreshArticleContent: PublishRefreshArticleContent = async (params) => {
	await events.publishEvent({
		source: RefreshArticleContentCommand.source,
		detailType: RefreshArticleContentCommand.detailType,
		detail: JSON.stringify({
			url: params.url,
			html: params.html,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			etag: params.etag,
			lastModified: params.lastModified,
			contentFetchedAt: params.contentFetchedAt,
		}),
	});
};

const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = async (params) => {
	await events.publishEvent({
		source: UpdateFetchTimestampCommand.source,
		detailType: UpdateFetchTimestampCommand.detailType,
		detail: JSON.stringify({
			url: params.url,
			contentFetchedAt: params.contentFetchedAt,
		}),
	});
};

const publishSaveAnonymousLink: PublishSaveAnonymousLink = async (params) => {
	await events.publishEvent({
		source: SaveAnonymousLinkCommand.source,
		detailType: SaveAnonymousLinkCommand.detailType,
		detail: JSON.stringify({ url: params.url }),
	});
};

const { findArticleFreshness } = initFindArticleFreshness({
	client,
	tableName: articlesTable,
});

const { findArticleCrawlStatus } = initFindArticleCrawlStatus({
	client,
	tableName: articlesTable,
});

const { refreshArticleIfStale } = initRefreshArticleIfStale({
	findArticleFreshness,
	findArticleCrawlStatus,
	crawlArticle,
	parseHtml,
	publishRefreshArticleContent,
	publishUpdateFetchTimestamp,
	now: () => new Date(),
	staleTtlMs: STALE_TTL_MS,
});

export const handler = initStaleCheckHandler({
	refreshArticleIfStale,
	publishSaveAnonymousLink,
	loadArticle: articleAggregate.store.load,
	transitionAndPersist: articleAggregate.transitionAndPersist,
	now: () => new Date(),
	logger: consoleLogger,
});
