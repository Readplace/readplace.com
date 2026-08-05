/* c8 ignore start -- one-off backfill script, run manually against staging then prod */
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	ConditionalCheckFailedException,
	createDynamoDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { requireEnv } from "@packages/require-env";

const logger = HutchLogger.from(consoleLogger);

/**
 * Records legacy articles as having become readable at the epoch, so the digest
 * gate reads them as "available long before you saved this" rather than
 * "available just now".
 *
 * MUST run before the deploy that starts writing the column. An admin recrawl
 * raw-writes crawlStatus=pending, bypassing the aggregate, so the aggregate then
 * sees an unstamped non-ready row and stamps the recrawl's own clock —
 * permanently recording a years-old article as having become readable today, and
 * emailing everyone who ever opened it. The epoch stamp closes that door for
 * good: `if_not_exists` can never overwrite it.
 *
 * Rows still pending or failed are deliberately left unstamped so their first
 * genuine transition to ready records the real instant and their viewers stay
 * legitimately emailable.
 */
const EPOCH = new Date(0).toISOString();

const BackfillRow = z.object({
	url: z.string(),
	crawlStatus: dynamoField(z.string()),
	contentLocation: dynamoField(z.string()),
	readerAvailableAt: dynamoField(z.string()),
});

type BackfillRow = z.infer<typeof BackfillRow>;

/** Which legacy shape makes a row eligible, or undefined to leave it alone. */
function bucketFor(row: BackfillRow): string | undefined {
	if (row.crawlStatus === "ready") return "crawl-ready";
	if (row.crawlStatus === "unsupported") return "crawl-unsupported";
	if (row.crawlStatus === undefined && row.contentLocation !== undefined) {
		return "pre-state-machine-with-content";
	}
	return undefined;
}

async function main(): Promise<void> {
	const apply = process.argv.includes("--apply");
	const tableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
	const client = createDynamoDocumentClient();
	const articles = defineDynamoTable({ client, tableName, schema: BackfillRow });

	logger.info(
		`Readplace - backfilling readerAvailableAt=${EPOCH} on ${tableName} (${apply ? "APPLY" : "dry run"})`,
	);

	const counts: Record<string, number> = {
		unstamped: 0,
		"crawl-ready": 0,
		"crawl-unsupported": 0,
		"pre-state-machine-with-content": 0,
		"left-unstamped": 0,
		stamped: 0,
		"already-stamped": 0,
	};

	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const { items, lastEvaluatedKey } = await articles.scan({
			ProjectionExpression: "#url, crawlStatus, contentLocation, readerAvailableAt",
			ExpressionAttributeNames: { "#url": "url" },
			FilterExpression: "attribute_not_exists(readerAvailableAt)",
			ExclusiveStartKey: exclusiveStartKey,
		});
		exclusiveStartKey = lastEvaluatedKey;

		for (const item of items) {
			counts.unstamped++;
			const bucket = bucketFor(item);
			if (bucket === undefined) {
				counts["left-unstamped"]++;
				continue;
			}
			counts[bucket]++;
			if (!apply) continue;
			try {
				await articles.update({
					Key: { url: item.url },
					UpdateExpression: "SET readerAvailableAt = :epoch",
					ConditionExpression: "attribute_not_exists(readerAvailableAt)",
					ExpressionAttributeValues: { ":epoch": EPOCH },
				});
				counts.stamped++;
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
				counts["already-stamped"]++;
			}
		}
		logger.info(`… ${counts.unstamped} unstamped rows examined so far`);
	} while (exclusiveStartKey);

	logger.info(`Done. ${JSON.stringify(counts)}`);
	if (!apply) logger.info("Dry run — re-run with --apply to write.");
}

main().catch((err) => {
	logger.error("Backfill failed:", err);
	process.exit(1);
});
/* c8 ignore stop */
