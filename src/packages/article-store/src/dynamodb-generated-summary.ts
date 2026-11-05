import { SummaryStatusSchema } from "@packages/article-state-types";
import {
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import { summaryMatchesCanonical } from "@packages/domain/article-aggregate";
import { type ShownSummary, shownSummary } from "@packages/domain/article";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { VerificationFields, isUnverifiedWrapperContent } from "./verified-content";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	GeneratedSummary,
	FindGeneratedSummaries,
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import { SummaryStageColumn, decodeSummaryColumns } from "./status-columns";

export const ArticleSummaryRow = z.object({
	url: z.string(),
	...VerificationFields,
	summary: dynamoField(z.string()),
	canonicalContentHash: dynamoField(z.string()),
	summarySourceContentHash: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	summaryFailureReason: dynamoField(z.string()),
	// Plain string on read for forward-compat with future codes; UI mapper
	// surfaces a fallback message for any value not in SummarySkipReasonSchema.
	summarySkippedReason: dynamoField(z.string()),
	summaryStage: dynamoField(SummaryStageColumn),
	ownerUserId: dynamoField(UserIdSchema),
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

export function rowToGeneratedSummary(
	row: ArticleSummaryRowShape | undefined,
): GeneratedSummary | undefined {
	if (!row) return undefined;
	if (isUnverifiedWrapperContent(row)) return undefined;
	if ((row.summaryStatus === "ready" || (row.summaryStatus === undefined && row.summary !== undefined)) &&
		!summaryMatchesCanonical({ candidateId: row.canonicalCandidateId, summarySourceContentHash: row.summarySourceContentHash, canonicalContentHash: row.canonicalContentHash })) return undefined;
	const columns = decodeSummaryColumns(row);
	if (columns.summaryStatus === "failed") {
		return { status: "failed", reason: columns.summaryFailureReason };
	}
	if (columns.summaryStatus === "skipped") {
		return row.summarySkippedReason
			? { status: "skipped", reason: row.summarySkippedReason }
			: { status: "skipped" };
	}
	if (columns.summaryStatus === "pending") {
		return row.summaryStage
			? { status: "pending", stage: row.summaryStage }
			: { status: "pending" };
	}
	if (columns.summaryStatus === "ready") {
		return readyFromRow(columns.summary, row.summaryExcerpt);
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
	now: () => Date;
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

	const findGeneratedSummary: FindGeneratedSummary = async ({ url, viewer }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get({ url: articleResourceUniqueId.value }, { consistentRead: true });
		return shownSummary({ url, summary: rowToGeneratedSummary(row), viewer, ownerUserId: row?.ownerUserId });
	};

	const findGeneratedSummaries: FindGeneratedSummaries = async ({ urls, viewer }) => {
		const result = new Map<string, ShownSummary | undefined>();
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
			consistentRead: true,
		});

		const valueByKey = new Map<string, { summary: GeneratedSummary | undefined; ownerUserId: UserId | undefined }>();
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
			valueByKey.set(row.url, { summary: value, ownerUserId: parsed.data?.ownerUserId });
		}
		for (const [key, groupUrls] of keyToUrls) {
			const stored = valueByKey.get(key);
			for (const url of groupUrls)
				result.set(
					url,
					shownSummary({ url, summary: stored?.summary, viewer, ownerUserId: stored?.ownerUserId }),
				);
		}
		return result;
	};

	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await writeIfCondition(() =>
			table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET summaryStatus = :pending, summaryPendingSince = if_not_exists(summaryPendingSince, :pendingSince)",
				ConditionExpression:
					"attribute_not_exists(summaryStatus) OR summaryStatus <> :ready",
				ExpressionAttributeValues: {
					":pending": "pending",
					":pendingSince": deps.now().toISOString(),
					":ready": "ready",
				},
			}),
		);
	};

	return { findGeneratedSummary, findGeneratedSummaries, markSummaryPending };
}
