import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	CrawlFailureReasonSchema,
	CrawlStatusSchema,
	CrawlUnsupportedReasonSchema,
	SummaryFailureReasonSchema,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import type {
	AggregateField,
	Article,
	ArticleStore,
	CanonicalCommit,
	ContentSelectionSnapshot,
	SelectionExpected,
	CrawlState,
	SummaryState,
} from "@packages/domain/article-aggregate";
import { SelectionSnapshotChangedError } from "@packages/domain/article-aggregate";
import {
	type DynamoDBDocumentClient,
	assembleRowUpdate,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import { classifyRefusedSelection, prepareCanonicalCommit, prepareExpectedSelection } from "./canonical-commit";
import { SummaryStageColumn, decodeCrawlColumns, decodeSummaryColumns } from "./status-columns";
import { VerificationFields } from "./verified-content";

/**
 * Row schema for the Article aggregate. Each attribute is `dynamoField`
 * because legacy rows may be missing any of these (pre-state-machine rows,
 * rows that were saved before a particular field existed). The aggregate
 * fills in defaults at the mapping boundary.
 */
const ArticleAggregateRow = z.object({
	title: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	wordCount: dynamoField(z.number()),
	estimatedReadTime: dynamoField(z.number()),
	imageUrl: dynamoField(z.string()),
	publishedOn: dynamoField(z.string()),
	etag: dynamoField(z.string()),
	lastModified: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	canonicalContentHash: dynamoField(z.string()),
	bodyHash: dynamoField(z.string()),
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlUnsupportedReason: dynamoField(z.string()),
	crawlPendingSince: dynamoField(z.string()),
	crawlStartedAt: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	summaryPendingSince: dynamoField(z.string()),
	summary: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	summaryInputTokens: dynamoField(z.number()),
	summaryOutputTokens: dynamoField(z.number()),
	summarySourceContentHash: dynamoField(z.string()),
	summaryFailureReason: dynamoField(z.string()),
	summarySkippedReason: dynamoField(z.string()),
	summaryAutoHealAttempts: dynamoField(z.number()),
	summaryAutoHealLastAttemptAt: dynamoField(z.string()),
	readerAvailableAt: dynamoField(z.string()),
	savedAt: dynamoField(z.string()),
	purgedAt: dynamoField(z.string()),
	contentSelectionRevision: dynamoField(z.number()),
	contentLocation: dynamoField(z.string()),
	...VerificationFields,
	sourceOriginalUrl: dynamoField(z.string()),
	meteredLegsDeferredSince: dynamoField(z.string()),
});

type RowShape = z.infer<typeof ArticleAggregateRow>;

const AGGREGATE_FIELDS = ArticleAggregateRow.keyof().options;

const ArticleAggregateWriteRow = ArticleAggregateRow.extend({
	summaryStage: dynamoField(SummaryStageColumn),
	crawlFailedAt: dynamoField(z.string()),
});

type WriteColumns = z.input<typeof ArticleAggregateWriteRow>;

type RowWrite = {
	set: Partial<WriteColumns>;
	remove: (keyof WriteColumns & string)[];
};

/**
 * 1. Legacy rows saved before `pendingSince` existed default to epoch 0 so the
 *    canary's age-gate immediately surfaces them once they cross MIN_AGE_MS.
 */
export const LEGACY_PENDING_SINCE = new Date(0).toISOString();

/**
 * 1. Legacy rows wrote a plain string (free-form, set by save-link-work and
 *    DLQ handlers). Map it onto the closest tagged-union variant so the
 *    reader can render it; new rows write a JSON-encoded discriminated union.
 */
function parseCrawlFailureReason(raw: string): import("@packages/article-state-types").CrawlFailureReason {
	if (raw.startsWith("{")) return CrawlFailureReasonSchema.parse(JSON.parse(raw));
	return { kind: "parse-error", detail: raw }; /* 1 */
}

function parseCrawlUnsupportedReason(raw: string): import("@packages/article-state-types").CrawlUnsupportedReason {
	if (raw.startsWith("{")) return CrawlUnsupportedReasonSchema.parse(JSON.parse(raw));
	return { kind: "non-html-content", contentType: raw }; /* 1 */
}

function parseSummaryFailureReason(raw: string): import("@packages/article-state-types").SummaryFailureReason {
	if (raw.startsWith("{")) return SummaryFailureReasonSchema.parse(JSON.parse(raw));
	if (raw === "crawl failed") return { kind: "crawl-failed" }; /* 1 */
	return { kind: "exhausted-retries", receiveCount: 0 }; /* 1 */
}

function rowToCrawlState(row: RowShape): CrawlState {
	const columns = decodeCrawlColumns(row);
	if (columns.crawlStatus === "failed") {
		return { kind: "failed", reason: parseCrawlFailureReason(columns.crawlFailureReason) };
	}
	if (columns.crawlStatus === "unsupported") {
		return {
			kind: "unsupported",
			reason: parseCrawlUnsupportedReason(columns.crawlUnsupportedReason),
		};
	}
	if (columns.crawlStatus === "ready") return { kind: "ready" };
	return {
		kind: "pending",
		pendingSince: row.crawlPendingSince ?? LEGACY_PENDING_SINCE /* 1 */,
		startedAt: row.crawlStartedAt,
	};
}

function rowToSummaryState(row: RowShape): SummaryState {
	const columns = decodeSummaryColumns(row);
	if (columns.summaryStatus === "ready") {
		const ready: Extract<SummaryState, { kind: "ready" }> = {
			kind: "ready",
			summary: columns.summary,
		};
		if (row.summaryExcerpt) ready.excerpt = row.summaryExcerpt;
		if (row.summaryInputTokens !== undefined)
			ready.inputTokens = row.summaryInputTokens;
		if (row.summaryOutputTokens !== undefined)
			ready.outputTokens = row.summaryOutputTokens;
		if (row.summarySourceContentHash !== undefined)
			ready.sourceContentHash = row.summarySourceContentHash;
		return ready;
	}
	if (columns.summaryStatus === "failed") {
		return {
			kind: "failed",
			reason: parseSummaryFailureReason(columns.summaryFailureReason),
		};
	}
	if (columns.summaryStatus === "skipped") {
		return row.summarySkippedReason
			? { kind: "skipped", reason: row.summarySkippedReason }
			: { kind: "skipped" };
	}
	return {
		kind: "pending",
		pendingSince: row.summaryPendingSince ?? LEGACY_PENDING_SINCE /* 1 */,
	};
}

function rowToArticle(url: string, row: RowShape): Article {
	const summaryAutoHeal: Article["summaryAutoHeal"] = {
		attempts: row.summaryAutoHealAttempts ?? 0,
	};
	if (row.summaryAutoHealLastAttemptAt !== undefined) {
		summaryAutoHeal.lastAttemptAt = row.summaryAutoHealLastAttemptAt;
	}
	return {
		url,
		metadata: {
			title: row.title ?? "",
			siteName: row.siteName ?? "",
			excerpt: row.excerpt ?? "",
			wordCount: row.wordCount ?? 0,
			imageUrl: row.imageUrl,
			publishedOn: row.publishedOn,
		},
		freshness: {
			contentFetchedAt: row.contentFetchedAt ?? "",
			etag: row.etag,
			lastModified: row.lastModified,
			canonicalContentHash: row.canonicalContentHash,
			bodyHash: row.bodyHash,
		},
		estimatedReadTime: row.estimatedReadTime ?? 0,
		crawl: rowToCrawlState(row),
		summary: rowToSummaryState(row),
		summaryAutoHeal,
		readerAvailableAt: row.readerAvailableAt,
		savedAt: row.savedAt,
		purgedAt: row.purgedAt,
		contentSelection: contentSelectionFromRow(row),
	};
}

function contentSelectionFromRow(row: RowShape): ContentSelectionSnapshot {
	return {
		revision: row.contentSelectionRevision,
		contentLocation: row.contentLocation,
		candidateId: row.canonicalCandidateId,
		tier: row.contentSourceTier,
		displayUrl: row.displayUrl,
		contentSourceUrl: row.contentSourceUrl,
		directContentBeforePin: row.directContentBeforePin,
		sourceOriginalUrl: row.sourceOriginalUrl,
		revokedCandidateIds: row.revokedCandidateIds === undefined ? undefined : [...row.revokedCandidateIds],
	};
}

function appendMetadataClauses(article: Article, write: RowWrite): void {
	write.set.title = article.metadata.title;
	write.set.siteName = article.metadata.siteName;
	write.set.excerpt = article.metadata.excerpt;
	write.set.wordCount = article.metadata.wordCount;
	write.set.estimatedReadTime = article.estimatedReadTime;
	write.set.imageUrl = article.metadata.imageUrl ?? null;
	write.set.publishedOn = article.metadata.publishedOn ?? null;
}

function appendFreshnessClauses(article: Article, write: RowWrite): void {
	write.set.contentFetchedAt = article.freshness.contentFetchedAt;
	write.set.etag = article.freshness.etag ?? null;
	write.set.lastModified = article.freshness.lastModified ?? null;
	write.set.canonicalContentHash = article.freshness.canonicalContentHash ?? null;
	write.set.bodyHash = article.freshness.bodyHash ?? null;
}

function appendSummaryClauses(article: Article, write: RowWrite): void {
	if (article.summary.kind === "pending") {
		write.set.summaryStatus = "pending";
		write.set.summaryPendingSince = article.summary.pendingSince;
		write.remove.push(
			"summary",
			"summaryExcerpt",
			"summaryInputTokens",
			"summaryOutputTokens",
			"summarySourceContentHash",
			"summaryStage",
			"summaryFailureReason",
			"summarySkippedReason",
		);
		return;
	}
	if (article.summary.kind === "ready") {
		write.set.summaryStatus = "ready";
		write.set.summary = article.summary.summary;
		write.set.summaryExcerpt = article.summary.excerpt ?? null;
		write.set.summaryInputTokens = article.summary.inputTokens ?? null;
		write.set.summaryOutputTokens = article.summary.outputTokens ?? null;
		write.set.summarySourceContentHash = article.summary.sourceContentHash ?? null;
		write.remove.push(
			"summaryFailureReason",
			"summarySkippedReason",
			"summaryPendingSince",
			"summaryStage",
		);
		return;
	}
	if (article.summary.kind === "failed") {
		write.set.summaryStatus = "failed";
		write.set.summaryFailureReason = JSON.stringify(article.summary.reason);
		write.remove.push("summarySkippedReason", "summaryPendingSince", "summaryStage");
		return;
	}
	write.set.summaryStatus = "skipped";
	if (article.summary.reason) {
		write.set.summarySkippedReason = article.summary.reason;
	} else {
		write.remove.push("summarySkippedReason");
	}
	write.remove.push("summaryFailureReason", "summaryPendingSince", "summaryStage");
}

function appendCrawlClauses(
	article: Article,
	write: RowWrite,
	handWritten: { clauses: string[]; values: Record<string, unknown> },
): void {
	if (article.crawl.kind !== "pending") {
		handWritten.clauses.push("crawlOutcomeRevision = if_not_exists(crawlOutcomeRevision, :zero) + :one");
		handWritten.values[":zero"] = 0;
		handWritten.values[":one"] = 1;
	}
	if (article.crawl.kind === "failed") {
		write.set.crawlStatus = "failed";
		write.set.crawlFailureReason = JSON.stringify(article.crawl.reason);
		write.remove.push("crawlUnsupportedReason", "crawlPendingSince", "crawlStartedAt");
		return;
	}
	if (article.crawl.kind === "unsupported") {
		write.set.crawlStatus = "unsupported";
		write.set.crawlUnsupportedReason = JSON.stringify(article.crawl.reason);
		write.remove.push("crawlFailureReason", "crawlPendingSince", "crawlStartedAt");
		return;
	}
	if (article.crawl.kind === "ready") {
		write.set.crawlStatus = "ready";
		write.remove.push(
			"crawlFailureReason",
			"crawlUnsupportedReason",
			"crawlFailedAt",
			"crawlPendingSince",
			"crawlStartedAt",
		);
		return;
	}
	write.set.crawlStatus = "pending";
	write.set.crawlPendingSince = article.crawl.pendingSince;
	write.remove.push("crawlFailureReason", "crawlUnsupportedReason");
}

function appendSummaryAutoHealClauses(article: Article, write: RowWrite): void {
	write.set.summaryAutoHealAttempts = article.summaryAutoHeal.attempts;
	if (article.summaryAutoHeal.lastAttemptAt !== undefined) {
		write.set.summaryAutoHealLastAttemptAt = article.summaryAutoHeal.lastAttemptAt;
	} else {
		write.remove.push("summaryAutoHealLastAttemptAt");
	}
}

/* `if_not_exists` is the concurrency backstop for the domain's read-modify-write:
 * two writers that both read an unstamped row still agree on the first instant.
 * Deliberately not a ConditionExpression — a losing race must not turn the whole
 * aggregate save into a no-op. */
function appendReaderAvailabilityClauses(
	article: Article,
	handWritten: { clauses: string[]; values: Record<string, unknown> },
): void {
	assert(
		article.readerAvailableAt,
		"readerAvailability write requires a stamped readerAvailableAt",
	);
	handWritten.clauses.push("readerAvailableAt = if_not_exists(readerAvailableAt, :raa)");
	handWritten.values[":raa"] = article.readerAvailableAt;
}

function buildSaveCommand(params: {
	article: Article;
	writes: readonly AggregateField[];
	canonicalCommit?: CanonicalCommit;
	selectionExpected?: SelectionExpected;
}): {
	UpdateExpression: string;
	ExpressionAttributeValues: Record<string, unknown>;
	ConditionExpression?: string;
} {
	const write: RowWrite = { set: {}, remove: [] };
	const handWrittenClauses: string[] = [];
	const handWritten: { clauses: string[]; values: Record<string, unknown> } = { clauses: handWrittenClauses, values: {} };

	const appendClauses: Record<AggregateField, () => void> = {
		metadata: () => appendMetadataClauses(params.article, write),
		freshness: () => appendFreshnessClauses(params.article, write),
		summary: () => appendSummaryClauses(params.article, write),
		crawl: () => appendCrawlClauses(params.article, write, handWritten),
		summaryAutoHeal: () => appendSummaryAutoHealClauses(params.article, write),
		readerAvailability: () => appendReaderAvailabilityClauses(params.article, handWritten),
	};
	for (const field of new Set(params.writes)) {
		appendClauses[field]();
	}

	const conditions = ["attribute_not_exists(purgedAt)"];
	const conditionValues: Record<string, unknown> = {};
	if (params.canonicalCommit !== undefined) {
		const commit = prepareCanonicalCommit(params.canonicalCommit);
		handWrittenClauses.push(...commit.sets);
		conditions.push(...commit.conditions);
		Object.assign(handWritten.values, commit.values);
	}
	if (params.selectionExpected !== undefined) {
		const expected = prepareExpectedSelection(params.selectionExpected);
		conditions.push(...expected.conditions);
		Object.assign(conditionValues, expected.values);
	}
	return assembleRowUpdate({
		schema: ArticleAggregateWriteRow,
		set: write.set,
		remove: write.remove,
		handWrittenSet: handWritten,
		condition: { kind: "expression", expression: conditions.join(" AND "), values: conditionValues },
	});
}

export function initDynamoDbArticleStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { store: ArticleStore } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleAggregateRow,
	});

	const store: ArticleStore = {
		load: async (url) => {
			const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
			const row = await table.get(
				{ url: articleResourceUniqueId.value },
				{ projection: AGGREGATE_FIELDS, consistentRead: true },
			);
			if (!row) return undefined;
			return rowToArticle(url, row);
		},
		save: async ({ article, writes, canonicalCommit, selectionExpected }) => {
			const articleResourceUniqueId = ArticleResourceUniqueId.parse(article.url);
			const { UpdateExpression, ExpressionAttributeValues, ConditionExpression } = buildSaveCommand({
				article,
				writes,
				canonicalCommit,
				selectionExpected,
			});
			/* A purged (tombstoned) row must never be resurrected by an in-flight or
			 * DLQ-redriven transition; a fresh save clears purgedAt first, so
			 * post-revival transitions pass again. */
			const outcome = await writeIfCondition(() =>
				table.update({
					Key: { url: articleResourceUniqueId.value },
					UpdateExpression,
					ConditionExpression,
					ExpressionAttributeValues,
					ReturnValuesOnConditionCheckFailure: "ALL_OLD",
				}),
			);
			if (outcome.kind === "written" || outcome.oldItem?.purgedAt !== undefined || (canonicalCommit === undefined && selectionExpected === undefined)) return;
			if (outcome.oldItem === undefined) throw outcome.error;
			throw new SelectionSnapshotChangedError(classifyRefusedSelection({ oldItem: outcome.oldItem, canonicalCommit, selectionExpected }));
		},
	};

	return { store };
}
