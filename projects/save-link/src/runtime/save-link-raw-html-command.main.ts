import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "../require-env";
import { initReadPendingHtml } from "./providers/article-store/read-pending-html";
import { initSaveLinkRawHtmlCommandHandler } from "./domain/save-link-raw-html/save-link-raw-html-command-handler";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initCrawlAndFinalizeDepBundle } from "./dep-bundles/crawl-and-finalize";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const pendingHtmlBucketName = requireEnv("PENDING_HTML_BUCKET_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

// This Lambda consumes already-fetched HTML from S3 (pendingHtml bucket) and
// never re-crawls a URL through crawlArticle. It still goes through the
// unified `finalizeArticle` pipeline so the og:image is fetched + uploaded to
// the CDN with the same algorithm every other path uses — no per-trigger
// drift on what lands in the metadata.
const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link-raw-html", now });
const parser = initParserDepBundle({ logError: observability.logError });
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({ parser, articleStore, logger: consoleLogger, imagesCdnBaseUrl });
const crawlAndFinalize = initCrawlAndFinalizeDepBundle({
	parser,
	media,
	articleStore,
	imagesCdnBaseUrl,
	logError: observability.logError,
});
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });

const { readPendingHtml } = initReadPendingHtml({ client: s3Client, bucketName: pendingHtmlBucketName });

export const handler = initSaveLinkRawHtmlCommandHandler({
	...articleStore,
	...events,
	...articleAggregate,
	...observability,
	finalizeArticle: crawlAndFinalize.finalizeArticle,
	readPendingHtml,
});
