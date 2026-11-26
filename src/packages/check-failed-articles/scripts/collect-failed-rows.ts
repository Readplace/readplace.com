import { createHash } from "node:crypto";
import {
	classifyCrawlOutcome,
	classifySummaryOutcome,
	type CrawlFailureReason,
	CrawlStatusSchema,
	parseCrawlFailureReason,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import {
	CRAWL_STATUS_INDEX,
	SUMMARY_STATUS_INDEX,
} from "@packages/provider-contracts/article-status-indexes";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/storage-client";
import { z } from "zod";
import { isExcluded } from "./exclude-patterns";

/* `dynamoField` normalises DDB's `null` for absent attributes to `undefined`. */
const FailedArticleRow = z.object({
	url: z.string(),
	originalUrl: dynamoField(z.string()),
	/* Required (not dynamoField): the `attribute_exists(...) AND <> :pending`
	 * filter only returns rows where both axes are present and terminal. */
	crawlStatus: CrawlStatusSchema,
	crawlFailureReason: dynamoField(z.string()),
	summaryStatus: SummaryStatusSchema,
	summaryFailureReason: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	savedAt: z.string(),
	fullCrawlRequestedAt: z.string().optional().catch(undefined),
	resolutionOnViewClaimedAt: z.string().optional().catch(undefined),
});

export type FailedAxis = "crawl-failed" | "summary-failed";

export interface FailedRow {
	originalUrl: string;
	axes: FailedAxis[];
	/** Raw failure-reason strings keyed by axis — present when the writer set them. */
	reasons: Partial<Record<FailedAxis, string>>;
	savedAt: string;
	contentFetchedAt: string | undefined;
}

export interface CollectedFailedRow extends FailedRow {
	articleKey: string;
	fullCrawlRequestedAt: string | undefined;
	resolutionOnViewClaimedAt: string | undefined;
}

export function buildQueryInputs() {
	const expressionAttributeValues: Record<string, string> = {
		":failed": "failed",
		":pending": "pending",
	};
	const shared = {
		ProjectionExpression:
			"originalUrl, #u, crawlStatus, crawlFailureReason, " +
			"summaryStatus, summaryFailureReason, contentFetchedAt, savedAt, " +
			"fullCrawlRequestedAt, resolutionOnViewClaimedAt",
		ExpressionAttributeNames: { "#u": "url" },
		ExpressionAttributeValues: expressionAttributeValues,
	};
	const meteredLegsTried = "attribute_exists(fullCrawlRequestedAt) AND attribute_not_exists(meteredLegsDeferredSince)";
	return [
		{
			...shared,
			IndexName: CRAWL_STATUS_INDEX,
			KeyConditionExpression: "crawlStatus = :failed",
			FilterExpression: `attribute_exists(summaryStatus) AND summaryStatus <> :pending AND ${meteredLegsTried}`,
		},
		{
			...shared,
			IndexName: SUMMARY_STATUS_INDEX,
			KeyConditionExpression: "summaryStatus = :failed",
			FilterExpression: `attribute_exists(crawlStatus) AND crawlStatus <> :pending AND ${meteredLegsTried}`,
		},
	] as const;
}

function isSpendCappedBlock(reason: CrawlFailureReason | undefined): boolean {
	return reason !== undefined && reason.kind === "blocked" && reason.cause === "spend-capped";
}

function isNotFound(reason: CrawlFailureReason | undefined): boolean {
	return reason !== undefined && reason.kind === "not-found";
}

function classifyAxes(row: z.infer<typeof FailedArticleRow>): {
	axes: FailedAxis[];
	reasons: Partial<Record<FailedAxis, string>>;
} {
	const axes: FailedAxis[] = [];
	const reasons: Partial<Record<FailedAxis, string>> = {};
	const crawlReason = parseCrawlFailureReason(row.crawlFailureReason);
	if (
		classifyCrawlOutcome(row.crawlStatus) === "error" &&
		!isSpendCappedBlock(crawlReason) &&
		!isNotFound(crawlReason)
	) {
		axes.push("crawl-failed");
		if (row.crawlFailureReason !== undefined) reasons["crawl-failed"] = row.crawlFailureReason;
	}
	if (row.crawlStatus === "ready" && classifySummaryOutcome(row.summaryStatus) === "error") {
		axes.push("summary-failed");
		if (row.summaryFailureReason !== undefined)
			reasons["summary-failed"] = row.summaryFailureReason;
	}
	return { axes, reasons };
}

export async function collectFailedRows(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	excludePatterns: readonly RegExp[];
	ignoredKeyHashes?: ReadonlySet<string>;
}): Promise<CollectedFailedRow[]> {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: FailedArticleRow,
	});
	const candidates = new Map<string, z.infer<typeof FailedArticleRow>>();
	for (const input of buildQueryInputs()) {
		await forEachQueryPage(table, input, async (items) => {
			for (const row of items) candidates.set(row.url, row);
		});
	}
	const failed: CollectedFailedRow[] = [];
	const { ignoredKeyHashes } = deps;
	for (const row of candidates.values()) {
		const effectiveUrl = row.originalUrl ?? row.url;
		if (isExcluded(effectiveUrl, deps.excludePatterns)) continue;
		if (
			ignoredKeyHashes?.size &&
			ignoredKeyHashes.has(createHash("sha256").update(row.url, "utf8").digest("hex"))
		) continue;
		const { axes, reasons } = classifyAxes(row);
		if (axes.length === 0) continue;
		failed.push({
			articleKey: row.url,
			originalUrl: effectiveUrl,
			axes,
			reasons,
			savedAt: row.savedAt,
			contentFetchedAt: row.contentFetchedAt,
			fullCrawlRequestedAt: row.fullCrawlRequestedAt,
			resolutionOnViewClaimedAt: row.resolutionOnViewClaimedAt,
		});
	}
	return failed;
}
