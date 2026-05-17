import { SQSClient } from "@aws-sdk/client-sqs";
import OpenAI from "openai";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { DEFAULT_CRAWL_HEADERS, initCrawlArticle, initCrawlFetch, initMupdfRasterizer } from "@packages/crawl-article";
import { initTransitionAndPersist } from "@packages/domain/article-aggregate";
import {
	GenerateSummaryCommand,
	RefreshArticleContentCommand,
	SaveAnonymousLinkCommand,
	UpdateFetchTimestampCommand,
} from "@packages/hutch-infra-components";
import {
	EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
} from "@packages/hutch-infra-components/runtime";
import { consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initRefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type {
	PublishRefreshArticleContent,
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/test-fixtures/providers/events";
import { initLambdaEffectDispatcher } from "./domain/article-aggregate/lambda-effect-dispatcher";
import { initReadabilityParser } from "./domain/article-parser/readability-parser";
import { theInformationPreParser } from "./domain/article-parser/the-information-pre-parser";
import { mediumPreParser } from "./domain/article-parser/medium-pre-parser";
import { initSaveLinkPdfExtract } from "./domain/article-parser/init-save-link-pdf-extract";
import { initFindArticleCrawlStatus } from "./providers/article-crawl/find-article-crawl-status";
import { initFindArticleFreshness } from "./providers/article-crawl/find-article-freshness";
import { requireEnv } from "../require-env";
import { initStaleCheckHandler } from "./domain/save-link/stale-check-handler";

// 24h: mirrors hutch app.ts's staleTtlMs. Reads of an article older than this
// trigger a conditional GET against the source (304 → noop, 200 → re-extract).
const STALE_TTL_MS = 86_400_000;

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const deepInfraApiKey = requireEnv("DEEPINFRA_API_KEY");

const client = createDynamoDocumentClient();
const sqsClient = new SQSClient({});
const logError = (message: string, error?: Error) =>
	consoleLogger.error(message, { error });

const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 300_000,
});

const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, defaultHeaders: { ...DEFAULT_CRAWL_HEADERS } });
const extractPdf = initSaveLinkPdfExtract({
	rasterizer: initMupdfRasterizer({ logger: consoleLogger }),
	createChatCompletion: (params) => deepInfraClient.chat.completions.create(params),
	logger: consoleLogger,
});
const crawlArticle = initCrawlArticle({ crawlFetch, extractPdf, logError });

const { parseHtml } = initReadabilityParser({
	crawlArticle,
	sitePreParsers: [theInformationPreParser, mediumPreParser],
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

const { store } = initDynamoDbArticleStore({ client, tableName: articlesTable });

const { dispatch: dispatchGenerateSummary } = initSqsCommandDispatcher({
	sqsClient,
	queueUrl: generateSummaryQueueUrl,
	command: GenerateSummaryCommand,
});

const { dispatchEffect } = initLambdaEffectDispatcher({
	dispatchGenerateSummary,
	publishEvent,
});

const { transitionAndPersist } = initTransitionAndPersist({
	store,
	dispatchEffect,
});

export const handler = initStaleCheckHandler({
	refreshArticleIfStale,
	publishSaveAnonymousLink,
	loadArticle: store.load,
	transitionAndPersist,
	now: () => new Date(),
	logger: consoleLogger,
});
