import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { consoleLogger } from "@packages/hutch-logger";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/hutch-infra-components/runtime";
import {
	RefreshArticleContentCommand,
	SaveAnonymousLinkCommand,
	UpdateFetchTimestampCommand,
} from "@packages/hutch-infra-components";
import { DEFAULT_CRAWL_HEADERS, initCrawlArticle, initCrawlFetch } from "@packages/crawl-article";
import { initRefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import { initReadabilityParser } from "../article-parser/readability-parser";
import { theInformationPreParser } from "../article-parser/the-information-pre-parser";
import type {
	PublishRefreshArticleContent,
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/test-fixtures/providers/events";
import { requireEnv } from "../require-env";
import { initStaleCheckHandler } from "../save-link/stale-check-handler";
import { initFindArticleFreshness } from "../crawl-article-state/find-article-freshness";
import { initFindArticleCrawlStatus } from "../crawl-article-state/find-article-crawl-status";
import { initAutoHealStore } from "../crawl-article-state/increment-crawl-auto-heal-attempt";
import { initIncrementCrawlAutoHealAttempt } from "@packages/test-fixtures/providers/article-crawl";

// 24h: mirrors hutch app.ts's staleTtlMs. Reads of an article older than this
// trigger a conditional GET against the source (304 → noop, 200 → re-extract).
const STALE_TTL_MS = 86_400_000;

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const client = createDynamoDocumentClient();
const logError = (message: string, error?: Error) =>
	consoleLogger.error(message, { error });

const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, defaultHeaders: { ...DEFAULT_CRAWL_HEADERS } });
const crawlArticle = initCrawlArticle({ crawlFetch, logError });

const { parseHtml } = initReadabilityParser({
	crawlArticle,
	sitePreParsers: [theInformationPreParser],
	logError,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const publishRefreshArticleContent: PublishRefreshArticleContent = async (params) => {
	await publishEvent({
		source: RefreshArticleContentCommand.source,
		detailType: RefreshArticleContentCommand.detailType,
		detail: JSON.stringify({
			url: params.url,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			etag: params.etag,
			lastModified: params.lastModified,
			contentFetchedAt: params.contentFetchedAt,
		}),
	});
};

const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = async (params) => {
	await publishEvent({
		source: UpdateFetchTimestampCommand.source,
		detailType: UpdateFetchTimestampCommand.detailType,
		detail: JSON.stringify({
			url: params.url,
			contentFetchedAt: params.contentFetchedAt,
		}),
	});
};

const publishSaveAnonymousLink: PublishSaveAnonymousLink = async (params) => {
	await publishEvent({
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

const autoHealStore = initAutoHealStore({
	client,
	tableName: articlesTable,
});
const { incrementCrawlAutoHealAttempt } = initIncrementCrawlAutoHealAttempt({
	findAutoHealState: autoHealStore.findAutoHealState,
	writeAutoHealAttempt: autoHealStore.writeAutoHealAttempt,
});

const { refreshArticleIfStale } = initRefreshArticleIfStale({
	findArticleFreshness,
	findArticleCrawlStatus,
	incrementCrawlAutoHealAttempt,
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
	logger: consoleLogger,
});
