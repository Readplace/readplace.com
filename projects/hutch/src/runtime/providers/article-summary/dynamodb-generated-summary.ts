/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { SummaryStatusSchema } from "@packages/article-state-types";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	GeneratedSummary,
	FindGeneratedSummariesByUrls,
	FindGeneratedSummary,
	ForceMarkSummaryPending,
	MarkSummaryPending,
} from "@packages/test-fixtures/providers/article-summary";

const ArticleSummaryRow = z.object({
	url: z.string(),
	summary: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	summaryFailureReason: dynamoField(z.string()),
	// Plain string on read for forward-compat with future codes; UI mapper
	// surfaces a fallback message for any value not in SummarySkipReasonSchema.
	summarySkippedReason: dynamoField(z.string()),
	summaryStage: dynamoField(
		z.enum(["summary-started", "summary-generating"]),
	),
});

type ArticleSummaryRowShape = z.infer<typeof ArticleSummaryRow>;

function rowToGeneratedSummary(
	row: ArticleSummaryRowShape | undefined,
): GeneratedSummary | undefined {
	if (!row) return undefined;
	if (row.summaryStatus === "failed") {
		assert(row.summaryFailureReason, "summaryStatus=failed row must carry a summaryFailureReason");
		return { status: "failed", reason: row.summaryFailureReason };
	}
	if (row.summaryStatus === "skipped") {
		return row.summarySkippedReason
			? { status: "skipped", reason: row.summarySkippedReason }
			: { status: "skipped" };
	}
	if (row.summaryStatus === "pending") {
		return row.summaryStage
			? { status: "pending", stage: row.summaryStage }
			: { status: "pending" };
	}
	// Legacy row (summaryStatus absent). A backfilled `summary` column means the
	// row pre-dates the state machine but carried a pre-computed summary — expose
	// as ready. Otherwise return undefined so the caller can re-prime the pipeline
	// rather than rendering a stuck pending row that polls forever.
	if (!row.summary) return undefined;
	const ready: { status: "ready"; summary: string; excerpt?: string } = {
		status: "ready",
		summary: row.summary,
	};
	if (row.summaryExcerpt) ready.excerpt = row.summaryExcerpt;
	return ready;
}

export function initDynamoDbGeneratedSummary(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findGeneratedSummary: FindGeneratedSummary;
	findGeneratedSummariesByUrls: FindGeneratedSummariesByUrls;
	markSummaryPending: MarkSummaryPending;
	forceMarkSummaryPending: ForceMarkSummaryPending;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleSummaryRow,
	});

	const findGeneratedSummary: FindGeneratedSummary = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get({ url: articleResourceUniqueId.value });
		return rowToGeneratedSummary(row);
	};

	const findGeneratedSummariesByUrls: FindGeneratedSummariesByUrls = async (urls) => {
		const result = new Map<string, GeneratedSummary | undefined>();
		if (urls.length === 0) return result;

		// Two URLs may canonicalise to the same row (e.g. utm-stripped duplicates).
		// Dedupe keys for the BatchGet, then fan results back out to every input URL.
		const urlsByCanonical = new Map<string, string[]>();
		for (const url of urls) {
			const canonical = ArticleResourceUniqueId.parse(url).value;
			const bucket = urlsByCanonical.get(canonical);
			if (bucket) bucket.push(url);
			else urlsByCanonical.set(canonical, [url]);
		}

		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.tableName,
			schema: ArticleSummaryRow,
			keys: Array.from(urlsByCanonical.keys()).map((url) => ({ url })),
		});
		const summaryByCanonical = new Map<string, GeneratedSummary | undefined>(
			rows.map((row) => [row.url, rowToGeneratedSummary(row)] as const),
		);

		for (const [canonical, originalUrls] of urlsByCanonical) {
			const summary = summaryByCanonical.get(canonical);
			for (const original of originalUrls) {
				result.set(original, summary);
			}
		}
		return result;
	};

	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		try {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "SET summaryStatus = :pending",
				ConditionExpression:
					"attribute_not_exists(summaryStatus) OR summaryStatus <> :ready",
				ExpressionAttributeValues: {
					":pending": "pending",
					":ready": "ready",
				},
			});
		} catch (err) {
			if (!(err instanceof ConditionalCheckFailedException)) throw err;
		}
	};

	const forceMarkSummaryPending: ForceMarkSummaryPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET summaryStatus = :pending REMOVE summaryFailureReason, summarySkippedReason",
			ExpressionAttributeValues: {
				":pending": "pending",
			},
		});
	};

	return { findGeneratedSummary, findGeneratedSummariesByUrls, markSummaryPending, forceMarkSummaryPending };
}
/* c8 ignore stop */
