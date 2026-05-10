import { S3Client } from "@aws-sdk/client-s3";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initCrawlArticle, initCrawlFetch, DEFAULT_CRAWL_HEADERS } from "@packages/crawl-article";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initLogParseError, type ParseErrorEvent, initLogCrawlOutcome, type CrawlOutcomeEvent } from "@packages/hutch-infra-components";
import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { requireEnv } from "../require-env";
import { initReadabilityParser } from "../article-parser/readability-parser";
import { theInformationPreParser } from "../article-parser/the-information-pre-parser";
import { initS3PutImageObject } from "../save-link/s3-put-image-object";
import { initDownloadMedia } from "../save-link/download-media";
import { initProcessContentWithLocalMedia } from "../save-link/process-content-with-local-media";
import { initReadPendingHtml } from "../save-link-raw-html/read-pending-html";
import { initSaveLinkRawHtmlCommandHandler } from "../save-link-raw-html/save-link-raw-html-command-handler";
import { initDynamoDbArticleCrawl } from "../crawl-article-state/dynamodb-article-crawl";
import { initCheckTier0SourceExistsS3 } from "../crawl-article-state/check-tier-0-source-exists-s3";
import { initReadArticleCrawlStateDynamoDb } from "../crawl-article-state/read-article-crawl-state-dynamodb";
import { initReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initPutTierSource } from "../select-content/put-tier-source";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const pendingHtmlBucketName = requireEnv("PENDING_HTML_BUCKET_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const eventBusName = requireEnv("EVENT_BUS_NAME");

const logError = (message: string, error?: Error) => consoleLogger.error(message, { error });
const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, defaultHeaders: { ...DEFAULT_CRAWL_HEADERS } });
const crawlArticle = initCrawlArticle({ crawlFetch, logError });

const { parseHtml } = initReadabilityParser({
	crawlArticle,
	sitePreParsers: [theInformationPreParser],
	logError,
});

const { readPendingHtml } = initReadPendingHtml({
	client: s3Client,
	bucketName: pendingHtmlBucketName,
});

const { putImageObject } = initS3PutImageObject({
	client: s3Client,
	bucketName: contentBucketName,
});

const downloadMedia = initDownloadMedia({
	putImageObject,
	logger: consoleLogger,
	crawlFetch,
	imagesCdnBaseUrl,
});

const processContent = initProcessContentWithLocalMedia({
	rewriteHtmlUrls: (html, rewriteUrl) => {
		const plugin = urls({ eachURL: rewriteUrl });
		return posthtml().use(plugin).process(html).then((result) => result.html);
	},
});

const { putTierSource } = initPutTierSource({
	client: s3Client,
	bucketName: contentBucketName,
});

const { markCrawlFailed } = initDynamoDbArticleCrawl({
	client: dynamoClient,
	tableName: articlesTable,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const { logParseError } = initLogParseError({
	logger: HutchLogger.fromJSON<ParseErrorEvent>(),
	now: () => new Date(),
	source: "save-link-raw-html",
});

const { logCrawlOutcome } = initLogCrawlOutcome({
	logger: HutchLogger.fromJSON<CrawlOutcomeEvent>(),
	now: () => new Date(),
});

const { checkTier0SourceExists } = initCheckTier0SourceExistsS3({
	client: s3Client,
	bucketName: contentBucketName,
});

const { readArticleCrawlState } = initReadArticleCrawlStateDynamoDb({
	client: dynamoClient,
	tableName: articlesTable,
});

const { readTierSnapshot } = initReadTierSnapshot({
	checkTier0SourceExists,
	readArticleCrawlState,
});

export const handler = initSaveLinkRawHtmlCommandHandler({
	readPendingHtml,
	parseHtml,
	downloadMedia,
	processContent,
	putTierSource,
	publishEvent,
	markCrawlFailed,
	logger: consoleLogger,
	logParseError,
	logCrawlOutcome,
	readTierSnapshot,
});
