/**
 * One-shot manual backfill: re-derive every stored inbox email body from its
 * immutable raw `.eml` through the SAME pipeline the receive worker runs, so
 * bodies stored before ingest-time image rehosting existed gain their images.
 * Writes only `content.html` objects — no DynamoDB rows, no events (replaying
 * the receive handler would re-trigger link extraction and LLM triage).
 *
 * Run manually (no package.json command) after `pnpm nx run inbox:compile`:
 *
 *   source .env
 *   AWS_PROFILE=hutch-production AWS_REGION=ap-southeast-2 \
 *   DYNAMODB_INBOX_EMAILS_TABLE=hutch-inbox-emails-prod \
 *   RAW_EMAIL_BUCKET_NAME=hutch-inbox-raw-email-prod \
 *   CONTENT_BUCKET_NAME=hutch-article-content-prod \
 *   IMAGES_CDN_BASE_URL=https://cdn.readplace.com \
 *   DRY_RUN=true \
 *   node projects/inbox/dist/runtime/backfill-email-images.main.js
 *
 * Optional: BACKFILL_USER_ID=<userId> limits the run to one user (staged
 * rollout). Drop DRY_RUN for the real run. Re-runnable: keys are deterministic
 * and the raw `.eml` is immutable.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { CRAWL_PERSONAS, initCrawlFetch } from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import { parseEmail } from "@packages/domain/inbox";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { initS3ReadRawEmail, initS3WriteEmailContent } from "@packages/inbox-store";
import { getEnv, requireEnv } from "@packages/require-env";
import {
	BackfillEmailRowSchema,
	initBackfillEmailImages,
} from "./domain/inbox/backfill-email-images";
import { initDownloadEmailImages } from "./domain/inbox/download-email-images";
import { initStoreEmailBody } from "./domain/inbox/store-email-body";
import { initS3PutImageObject } from "./providers/article-image/s3-put-image-object";

const SLEEP_BETWEEN_ROWS_MS = 1_000;

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const rawEmailBucketName = requireEnv("RAW_EMAIL_BUCKET_NAME");
const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
const imagesCdnBaseUrl = requireEnv("IMAGES_CDN_BASE_URL");
const dryRun = getEnv("DRY_RUN") === "true";
const onlyUserId = getEnv("BACKFILL_USER_ID");

const s3Client = new S3Client({});
const logger = HutchLogger.from(consoleLogger);
const table = defineDynamoTable({
	client: createDynamoDocumentClient(),
	tableName: inboxEmailsTable,
	schema: BackfillEmailRowSchema,
});

const crawlFetch = initCrawlFetch({
	fetch: globalThis.fetch,
	personas: CRAWL_PERSONAS,
	isBlocked: isBlockedIpAddress,
});
const { putImageObject } = initS3PutImageObject({ client: s3Client, bucketName: contentBucketName });

const runBackfill = initBackfillEmailImages({
	scanEmailRowPages: async function* () {
		let lastEvaluatedKey: Record<string, unknown> | undefined;
		do {
			const page = await table.scan({
				ProjectionExpression:
					"userId, receivedAtMessageId, #status, receivedAt, rawEmailS3Key, bodyS3Key",
				ExpressionAttributeNames: { "#status": "status" },
				ExclusiveStartKey: lastEvaluatedKey,
			});
			yield page.items;
			lastEvaluatedKey = page.lastEvaluatedKey;
		} while (lastEvaluatedKey !== undefined);
	},
	readRawEmail: initS3ReadRawEmail({ client: s3Client, bucketName: rawEmailBucketName }),
	parseEmail,
	downloadEmailImages: initDownloadEmailImages({ crawlFetch, logger }),
	storeBody: initStoreEmailBody({
		putContent: initS3WriteEmailContent({ client: s3Client, bucketName: contentBucketName }),
		putImageObject,
		imagesCdnBaseUrl,
		logger,
	}),
	logger,
	dryRun,
	onlyUserId,
	sleepBetweenRows: () => sleep(SLEEP_BETWEEN_ROWS_MS),
});

runBackfill()
	.then((tally) => {
		logger.info("[backfill-email-images] finished", { dryRun, tally });
	})
	.catch((error) => {
		logger.error("[backfill-email-images] aborted", { error });
		process.exitCode = 1;
	});
