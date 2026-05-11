import assert from "node:assert";
import { SummaryStatusSchema } from "@packages/article-state-types";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";
import type {
	GeneratedSummary,
	FindGeneratedSummary,
	MarkSummaryFailed,
	MarkSummaryPending,
	MarkSummarySkipped,
	MarkSummaryStage,
	SaveGeneratedSummary,
} from "./article-summary.types";

const GeneratedSummaryRow = z.object({
	summary: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	summaryFailureReason: dynamoField(z.string()),
	// Plain string on read for forward-compat with future codes; UI mapper
	// surfaces a fallback message for any value not in SummarySkipReasonSchema.
	summarySkippedReason: dynamoField(z.string()),
});

type GeneratedSummaryRowShape = z.infer<typeof GeneratedSummaryRow>;

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
	row: GeneratedSummaryRowShape | undefined,
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
	if (row.summaryStatus === "pending") return { status: "pending" };
	if (row.summaryStatus === "ready") {
		// Status and text must move together. A row with status=ready and no
		// summary text means a writer dropped the text without resetting the
		// status (or vice versa) — fail loud here so the inconsistency surfaces
		// instead of degrading silently.
		assert(row.summary, "summaryStatus=ready row must carry a summary");
		return readyFromRow(row.summary, row.summaryExcerpt);
	}
	// Legacy row (summaryStatus absent). A backfilled `summary` column means the
	// row pre-dates the state machine but carried a pre-computed summary — expose
	// as ready. Otherwise return undefined so the caller can re-prime the pipeline
	// instead of treating the row as actively pending.
	if (!row.summary) return undefined;
	return readyFromRow(row.summary, row.summaryExcerpt);
}

async function swallowConditionalCheckFailure(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (err) {
		/* c8 ignore next -- V8 block-coverage phantom on the catch-clause continuation branch, see bcoe/c8#319 */
		if (!(err instanceof ConditionalCheckFailedException)) throw err;
	}
}

export function initDynamoDbGeneratedSummary(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findGeneratedSummary: FindGeneratedSummary;
	saveGeneratedSummary: SaveGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	markSummaryFailed: MarkSummaryFailed;
	markSummarySkipped: MarkSummarySkipped;
	markSummaryStage: MarkSummaryStage;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: GeneratedSummaryRow,
	});

	const findGeneratedSummary: FindGeneratedSummary = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get(
			{ url: articleResourceUniqueId.value },
			{
				projection: [
					"summary",
					"summaryExcerpt",
					"summaryStatus",
					"summaryFailureReason",
					"summarySkippedReason",
				],
			},
		);
		return rowToGeneratedSummary(row);
	};

	const saveGeneratedSummary: SaveGeneratedSummary = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			// REMOVE both reason attributes so a redrive that succeeds clears any
			// stale failure or skip marker from a prior attempt.
			UpdateExpression:
				"SET summary = :summary, summaryExcerpt = :excerpt, summaryInputTokens = :inputTokens, summaryOutputTokens = :outputTokens, summaryStatus = :ready REMOVE summaryFailureReason, summarySkippedReason",
			ExpressionAttributeValues: {
				":summary": params.summary,
				":excerpt": params.excerpt,
				":inputTokens": params.inputTokens,
				":outputTokens": params.outputTokens,
				":ready": "ready",
			},
		});
	};

	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Idempotent: never clobbers an existing ready row (re-saves of the same URL).
		await swallowConditionalCheckFailure(() =>
			table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "SET summaryStatus = :pending",
				ConditionExpression:
					"attribute_not_exists(summaryStatus) OR summaryStatus <> :ready",
				ExpressionAttributeValues: {
					":pending": "pending",
					":ready": "ready",
				},
			}),
		);
	};

	const markSummaryFailed: MarkSummaryFailed = async ({ url, reason }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Allow pending → failed (normal) and failed → failed (redrive that fails
		// again, possibly with a new reason). Block ready/skipped from regressing.
		await swallowConditionalCheckFailure(() =>
			table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET summaryStatus = :failed, summaryFailureReason = :reason",
				ConditionExpression:
					"attribute_not_exists(summaryStatus) OR summaryStatus = :pending OR summaryStatus = :failed",
				ExpressionAttributeValues: {
					":failed": "failed",
					":pending": "pending",
					":reason": reason,
				},
			}),
		);
	};

	const markSummarySkipped: MarkSummarySkipped = async ({ url, reason }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await swallowConditionalCheckFailure(() =>
			table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET summaryStatus = :skipped, summarySkippedReason = :reason",
				ConditionExpression:
					"attribute_not_exists(summaryStatus) OR summaryStatus = :pending",
				ExpressionAttributeValues: {
					":skipped": "skipped",
					":pending": "pending",
					":reason": reason,
				},
			}),
		);
	};

	const markSummaryStage: MarkSummaryStage = async ({ url, stage }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Unconditional: stage writes are monotonic by code order in the
		// summariser. SQS redelivery just rewrites the same sequence; we accept
		// a brief regression on redelivery rather than the cost of a conditional
		// check at every milestone.
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression: "SET summaryStage = :stage",
			ExpressionAttributeValues: { ":stage": stage },
		});
	};

	return {
		findGeneratedSummary,
		saveGeneratedSummary,
		markSummaryPending,
		markSummaryFailed,
		markSummarySkipped,
		markSummaryStage,
	};
}
