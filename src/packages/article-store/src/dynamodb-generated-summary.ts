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
	FindGeneratedSummaries,
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";

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

function readyFromRow(
	summary: string,
	excerpt: string | undefined,
): { status: "ready"; summary: string; excerpt?: string } {
	const ready: { status: "ready"; summary: string; excerpt?: string } = {
		status: "ready",
		summary,
	};
	if (excerpt) ready.excerpt = excerpt;
	return ready;
}

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
	if (row.summaryStatus === "ready") {
		// Status and text must move together. A row with status=ready and no
		// summary text means a writer dropped the text without resetting the
		// status (or vice versa) — fail loud here so the inconsistency surfaces
		// instead of degrading silently to a forever-polling reader UI.
		assert(row.summary, "summaryStatus=ready row must carry a summary");
		return readyFromRow(row.summary, row.summaryExcerpt);
	}
	// Legacy row (summaryStatus absent). A backfilled `summary` column means the
	// row pre-dates the state machine but carried a pre-computed summary — expose
	// as ready. Otherwise return undefined so the caller can re-prime the pipeline
	// rather than rendering a stuck pending row that polls forever.
	if (!row.summary) return undefined;
	return readyFromRow(row.summary, row.summaryExcerpt);
}

// Loose schema for the batch read: batchGetFromTable runs `schema.parse` on
// every returned item, so a strict schema would discard the whole batch on one
// malformed row. Each row is re-validated strictly below, per row.
const LooseArticleSummaryRow = z.looseObject({ url: z.string() });

export function initDynamoDbGeneratedSummary(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findGeneratedSummary: FindGeneratedSummary;
	findGeneratedSummaries: FindGeneratedSummaries;
	markSummaryPending: MarkSummaryPending;
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

	const findGeneratedSummaries: FindGeneratedSummaries = async (urls) => {
		const result = new Map<string, GeneratedSummary | undefined>();
		const keyToUrls = new Map<string, string[]>();
		for (const url of urls) {
			let normalizedKey: string;
			try {
				normalizedKey = ArticleResourceUniqueId.parse(url).value;
			} catch {
				result.set(url, undefined);
				continue;
			}
			const group = keyToUrls.get(normalizedKey);
			if (group) group.push(url);
			else keyToUrls.set(normalizedKey, [url]);
		}
		if (keyToUrls.size === 0) return result;

		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.tableName,
			schema: LooseArticleSummaryRow,
			keys: [...keyToUrls.keys()].map((url) => ({ url })),
			projection: ArticleSummaryRow.keyof().options,
		});

		const valueByKey = new Map<string, GeneratedSummary | undefined>();
		for (const row of rows) {
			const parsed = ArticleSummaryRow.safeParse(row);
			let value: GeneratedSummary | undefined;
			if (parsed.success) {
				try {
					value = rowToGeneratedSummary(parsed.data);
				} catch {
					value = undefined;
				}
			}
			valueByKey.set(row.url, value);
		}
		for (const [key, groupUrls] of keyToUrls) {
			const value = valueByKey.get(key);
			for (const url of groupUrls) result.set(url, value);
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

	return { findGeneratedSummary, findGeneratedSummaries, markSummaryPending };
}
