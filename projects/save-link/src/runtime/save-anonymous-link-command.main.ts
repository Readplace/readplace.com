import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createCanvas } from "@napi-rs/canvas";
import OpenAI from "openai";
import { consoleLogger } from "@packages/hutch-logger";
import { EventBridgeClient } from "@packages/hutch-infra-components/runtime";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "../require-env";
import { initSaveAnonymousLinkCommandHandler } from "./domain/save-link/save-anonymous-link-command-handler";
import { loadPdfjsLibAs } from "@packages/crawl-article";
import { initSaveLinkPdfExtract } from "./domain/article-parser/init-save-link-pdf-extract";
import { initObservabilityDepBundle } from "./dep-bundles/observability";
import { initParserDepBundle } from "./dep-bundles/parser";
import { initArticleStoreDepBundle } from "./dep-bundles/article-store";
import { initMediaDepBundle } from "./dep-bundles/media";
import { initEventsDepBundle } from "./dep-bundles/events";
import { initArticleAggregateDepBundle } from "./dep-bundles/article-aggregate";
import { initArticleCrawlDepBundle } from "./dep-bundles/article-crawl";

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const generateSummaryQueueUrl = requireEnv("GENERATE_SUMMARY_QUEUE_URL");
const deepInfraApiKey = requireEnv("DEEPINFRA_API_KEY");

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const dynamoClient = createDynamoDocumentClient();
const eventBridgeClient = new EventBridgeClient({});
const now = () => new Date();

const deepInfraClient = new OpenAI({
	apiKey: deepInfraApiKey,
	baseURL: "https://api.deepinfra.com/v1/openai",
	timeout: 300_000,
});

const extractPdf = initSaveLinkPdfExtract({
	createCanvas,
	createChatCompletion: (params) => deepInfraClient.chat.completions.create(params),
	loadPdfjsLibForRender: loadPdfjsLibAs,
});

const observability = initObservabilityDepBundle({ logger: consoleLogger, source: "save-link", now });
const parser = initParserDepBundle({ logError: observability.logError, extractPdf });
const articleStore = initArticleStoreDepBundle({ s3Client, dynamoClient, contentBucketName, articlesTable });
const media = initMediaDepBundle({ parser, articleStore, logger: consoleLogger, imagesCdnBaseUrl });
const events = initEventsDepBundle({ eventBridgeClient, eventBusName, sqsClient, generateSummaryQueueUrl });
const articleAggregate = initArticleAggregateDepBundle({ dynamoClient, articlesTable, events });
const articleCrawl = initArticleCrawlDepBundle({ dynamoClient, articlesTable });

export const handler = initSaveAnonymousLinkCommandHandler({
	...parser,
	...media,
	...articleStore,
	...events,
	...articleAggregate,
	...articleCrawl,
	...observability,
	imagesCdnBaseUrl,
	now,
});
