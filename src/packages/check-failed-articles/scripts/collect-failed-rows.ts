/**
 * DDB scan logic for the failed-articles canary, extracted so the unit tests
 * can exercise the filter expression and row-shaping without bootstrapping
 * the top-level `test()` block (which requires AWS env vars at import).
 *
 * A row is "failed" when both state-machine axes have reached a terminal
 * value (non-`pending`) AND at least one axis is a genuine error, as classified
 * by production's `classifyCrawlOutcome` / `classifySummaryOutcome`:
 *   - `crawlStatus` = failed
 *   - `summaryStatus` = failed
 *
 * Terminal-but-complete outcomes are NOT surfaced. `crawlStatus = unsupported`
 * is a definitive *supported* determination that the content type is one the
 * product does not render (e.g. an image) — correct behaviour, not a bug — and
 * `summaryStatus = skipped` means the worker deliberately produced no summary
 * (content too short, crawl failed first, etc.). Deriving the failure set from
 * the shared predicates keeps the canary in step with production: a new or
 * reclassified status is a compile break there, not a silent canary change.
 *
 * A crawl that `failed` with a `blocked`/`rate-limited` reason is likewise
 * dropped: that is the paid-crawl-budget circuit-breaker tripping — a
 * transient, self-inflicted spend cap, not a crawler defect. Re-saving only
 * re-trips it until the window frees, so it is not a debug-worklist item.
 *
 * The scan also accepts an optional lookback (in days) that gates rows on
 * `savedAt` — a value of `0` disables the gate and surfaces every historical
 * row, which is the default so the operator gets the full backlog and can
 * narrow it later by raising the value.
 */
import assert from "node:assert/strict";
import {
	classifyCrawlOutcome,
	classifySummaryOutcome,
	CrawlFailureReasonSchema,
	CrawlStatusSchema,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { isExcluded } from "./exclude-patterns";

/* `dynamoField` normalises DDB's `null` for absent attributes to `undefined`. */
const FailedArticleRow = z.object({
	url: z.string(),
	originalUrl: dynamoField(z.string()),
	/* Required (not dynamoField): the scan's `attribute_exists(...) AND <> :pending`
	 * filter only returns rows where both axes are present and terminal. */
	crawlStatus: CrawlStatusSchema,
	crawlFailureReason: dynamoField(z.string()),
	summaryStatus: SummaryStatusSchema,
	summaryFailureReason: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	savedAt: z.string(),
});

export type FailedAxis = "crawl-failed" | "summary-failed";

export interface FailedRow {
	originalUrl: string;
	axes: FailedAxis[];
	/** Raw failure-reason strings keyed by axis — present when the writer set them. */
	reasons: Partial<Record<FailedAxis, string>>;
	savedAt: string;
	contentFetchedAt: string | undefined;
	recrawlUrl: string;
}

/* The articles table completes a real scan in under 10 pages. Crossing 50
 * means the FilterExpression stopped narrowing (or the table grew an order of
 * magnitude) — fail loud instead of burning the runner's 10-minute budget. */
const MAX_PAGES = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build the DDB Scan input. When `lookbackDays` is `0` no time gate is
 * applied (every historical row is a candidate). For `lookbackDays > 0` the
 * gate is anchored to `savedAt` (always present, unlike `contentFetchedAt`
 * which only exists after a crawl produced content).
 */
export function buildScanInput(now: Date, lookbackDays: number) {
	assert(
		Number.isInteger(lookbackDays) && lookbackDays >= 0,
		`lookbackDays must be a non-negative integer (got ${lookbackDays})`,
	);
	const baseExpressionAttributeValues: Record<string, string> = {
		":pending": "pending",
		":crawlFailed": "failed",
		":summaryFailed": "failed",
	};
	const terminalUnsuccessful =
		"(crawlStatus = :crawlFailed OR summaryStatus = :summaryFailed)";
	const bothAxesTerminal =
		"attribute_exists(crawlStatus) AND attribute_exists(summaryStatus) " +
		"AND crawlStatus <> :pending AND summaryStatus <> :pending";
	let filterExpression = `${bothAxesTerminal} AND ${terminalUnsuccessful}`;
	const expressionAttributeValues = { ...baseExpressionAttributeValues };
	if (lookbackDays > 0) {
		const since = new Date(now.getTime() - lookbackDays * MS_PER_DAY).toISOString();
		filterExpression = `${filterExpression} AND savedAt >= :since`;
		expressionAttributeValues[":since"] = since;
	}
	return {
		FilterExpression: filterExpression,
		ProjectionExpression:
			"originalUrl, #u, crawlStatus, crawlFailureReason, " +
			"summaryStatus, summaryFailureReason, contentFetchedAt, savedAt",
		ExpressionAttributeNames: { "#u": "url" },
		ExpressionAttributeValues: expressionAttributeValues,
	} as const;
}

/* The crawl-failure reason is persisted as `JSON.stringify(reason)`; parse it
 * back and recognise the paid-crawl-budget block so the worklist can drop it.
 * Legacy rows whose reason is a bare (non-JSON) string fall through as "not a
 * rate-limited block" and surface normally. */
function isRateLimitedBlock(rawReason: string | undefined): boolean {
	if (rawReason === undefined) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawReason);
	} catch {
		return false;
	}
	const result = CrawlFailureReasonSchema.safeParse(parsed);
	if (!result.success) return false;
	return result.data.kind === "blocked" && result.data.cause === "rate-limited";
}

function classifyAxes(row: z.infer<typeof FailedArticleRow>): {
	axes: FailedAxis[];
	reasons: Partial<Record<FailedAxis, string>>;
} {
	const axes: FailedAxis[] = [];
	const reasons: Partial<Record<FailedAxis, string>> = {};
	if (
		classifyCrawlOutcome(row.crawlStatus) === "error" &&
		!isRateLimitedBlock(row.crawlFailureReason)
	) {
		axes.push("crawl-failed");
		if (row.crawlFailureReason !== undefined) reasons["crawl-failed"] = row.crawlFailureReason;
	}
	if (classifySummaryOutcome(row.summaryStatus) === "error") {
		axes.push("summary-failed");
		if (row.summaryFailureReason !== undefined)
			reasons["summary-failed"] = row.summaryFailureReason;
	}
	return { axes, reasons };
}

export async function collectFailedRows(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	origin: string;
	now: () => Date;
	lookbackDays: number;
	excludePatterns: readonly RegExp[];
}): Promise<FailedRow[]> {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: FailedArticleRow,
	});
	const failed: FailedRow[] = [];
	let pageCount = 0;
	let lastEvaluatedKey: Record<string, unknown> | undefined;
	const scanInput = buildScanInput(deps.now(), deps.lookbackDays);
	do {
		pageCount += 1;
		assert(
			pageCount <= MAX_PAGES,
			`pagination cap reached (${MAX_PAGES} pages) — refine FilterExpression or raise the cap if the table is legitimately growing`,
		);
		const page = await table.scan({
			...scanInput,
			ExclusiveStartKey: lastEvaluatedKey,
		});
		for (const row of page.items) {
			const effectiveUrl = row.originalUrl ?? row.url;
			if (isExcluded(effectiveUrl, deps.excludePatterns)) continue;
			const { axes, reasons } = classifyAxes(row);
			if (axes.length === 0) continue;
			failed.push({
				originalUrl: effectiveUrl,
				axes,
				reasons,
				savedAt: row.savedAt,
				contentFetchedAt: row.contentFetchedAt,
				recrawlUrl: `${deps.origin}/admin/recrawl/${encodeURIComponent(effectiveUrl)}`,
			});
		}
		lastEvaluatedKey = page.lastEvaluatedKey;
	} while (lastEvaluatedKey !== undefined);
	return failed;
}
