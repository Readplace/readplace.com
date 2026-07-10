import { S3Client } from "@aws-sdk/client-s3";
import {
	initReadabilityParser,
	linkedinSiteRules,
	mediumSiteRules,
	theInformationSiteRules,
} from "@packages/article-parser";
import {
	CRAWL_PERSONAS,
	initCrawlArticle,
	initCrawlFetch,
	initFetchThumbnailImage,
	initXTwitterSiteRules,
} from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initCrawlEmailLinkPreviewHandler } from "./domain/inbox/crawl-email-link-preview-handler";
import { initS3PutImageObject } from "./providers/article-image/s3-put-image-object";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";

const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const logger = HutchLogger.from(consoleLogger);
const logError = (message: string, error?: Error) =>
	logger.error(
		JSON.stringify({
			level: "ERROR",
			timestamp: new Date().toISOString(),
			message,
			stack: error?.stack,
		}),
	);
const logInfo = (message: string) =>
	logger.info(
		JSON.stringify({
			level: "INFO",
			timestamp: new Date().toISOString(),
			message,
		}),
	);

// The same SSRF-guarded crawlFetch the save pipeline uses: every connect and
// redirect hop runs isBlockedIpAddress, so a link that DNS-rebinds to a private
// or metadata address is refused at connect time.
const crawlFetch = initCrawlFetch({
	fetch: globalThis.fetch,
	personas: CRAWL_PERSONAS,
	isBlocked: isBlockedIpAddress,
});
const siteRules = [
	theInformationSiteRules,
	mediumSiteRules,
	linkedinSiteRules,
	initXTwitterSiteRules({ crawlFetch, logError }),
];
const crawlArticle = initCrawlArticle({ crawlFetch, siteRules, logError, logInfo });
const { parseHtml } = initReadabilityParser({
	crawlArticle,
	siteRules,
	logError,
});
const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError, logInfo });
const { putImageObject } = initS3PutImageObject({ client: s3Client, bucketName: contentBucketName });
// A preview keeps only the article metadata and discards the body, so media
// rewriting is a no-op here; the lead-image upload to the content-bucket CDN is
// the only media side effect a preview needs.
const finalizeArticle = initFinalizeArticle({
	parseHtml,
	downloadMedia: async () => [],
	processContent: async ({ html }) => html,
	fetchThumbnailImage,
	putImageObject,
	imagesCdnBaseUrl,
});
const crawlAndFinalize = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle });

const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: inboxEmailLinksTable,
});

export const handler = initCrawlEmailLinkPreviewHandler({
	crawlAndFinalize,
	setLinkOutcome: inboxEmailLinkStore.setLinkOutcome,
	logger,
});
