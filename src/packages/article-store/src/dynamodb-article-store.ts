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
	CrawlState,
	SummaryState,
} from "@packages/domain/article-aggregate";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";

/**
 * Row schema for the Article aggregate. Each attribute is `dynamoField`
 * because legacy rows may be missing any of these (pre-state-machine rows,
 * rows that were saved before a particular field existed). The aggregate
 * fills in defaults at the mapping boundary.
 *
 * Fields outside this schema (routeId, originalUrl, content, contentSourceTier)
 * are owned by separate writers and are *not* touched by the aggregate save —
 * the UpdateExpression below only writes the attributes the aggregate models.
 */
const ArticleAggregateRow = z.object({
	title: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	wordCount: dynamoField(z.number()),
	estimatedReadTime: dynamoField(z.number()),
	imageUrl: dynamoField(z.string()),
	etag: dynamoField(z.string()),
	lastModified: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	canonicalContentHash: dynamoField(z.string()),
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlUnsupportedReason: dynamoField(z.string()),
	crawlPendingSince: dynamoField(z.string()),
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
	aggregateTransitionName: dynamoField(z.string()),
});

type RowShape = z.infer<typeof ArticleAggregateRow>;

const AGGREGATE_FIELDS = ArticleAggregateRow.keyof().options;

/**
 * 1. Legacy rows saved before `pendingSince` existed default to epoch 0 so the
 *    canary's age-gate immediately surfaces them once they cross MIN_AGE_MS.
 *    Fallback is dropped after a follow-up canary scan reports zero legacy
 *    rows still in flight.
 */
const LEGACY_PENDING_SINCE = new Date(0).toISOString();

/**
 * 1. Legacy rows wrote a plain string (free-form, set by save-link-work and
 *    DLQ handlers). Map it onto the closest tagged-union variant so the
 *    reader can render it; new rows write a JSON-encoded discriminated union.
 *    Dropped after a follow-up canary scan reports zero legacy rows.
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
	if (row.crawlStatus === "failed") {
		assert(
			row.crawlFailureReason,
			"crawlStatus=failed row must carry crawlFailureReason",
		);
		return { kind: "failed", reason: parseCrawlFailureReason(row.crawlFailureReason) };
	}
	if (row.crawlStatus === "unsupported") {
		assert(
			row.crawlUnsupportedReason,
			"crawlStatus=unsupported row must carry crawlUnsupportedReason",
		);
		return {
			kind: "unsupported",
			reason: parseCrawlUnsupportedReason(row.crawlUnsupportedReason),
		};
	}
	if (row.crawlStatus === "ready") return { kind: "ready" };
	return {
		kind: "pending",
		pendingSince: row.crawlPendingSince ?? LEGACY_PENDING_SINCE /* 1 */,
	};
}

function rowToSummaryState(row: RowShape): SummaryState {
	if (row.summaryStatus === "ready") {
		assert(row.summary, "summaryStatus=ready row must carry summary");
		const ready: Extract<SummaryState, { kind: "ready" }> = {
			kind: "ready",
			summary: row.summary,
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
	if (row.summaryStatus === "failed") {
		assert(
			row.summaryFailureReason,
			"summaryStatus=failed row must carry summaryFailureReason",
		);
		return {
			kind: "failed",
			reason: parseSummaryFailureReason(row.summaryFailureReason),
		};
	}
	if (row.summaryStatus === "skipped") {
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
		},
		freshness: {
			contentFetchedAt: row.contentFetchedAt ?? "",
			etag: row.etag,
			lastModified: row.lastModified,
			canonicalContentHash: row.canonicalContentHash,
		},
		estimatedReadTime: row.estimatedReadTime ?? 0,
		crawl: rowToCrawlState(row),
		summary: rowToSummaryState(row),
		summaryAutoHeal,
	};
}

function appendMetadataClauses(
	article: Article,
	sets: string[],
	values: Record<string, unknown>,
): void {
	sets.push(
		"title = :title",
		"siteName = :siteName",
		"excerpt = :excerpt",
		"wordCount = :wordCount",
		"estimatedReadTime = :ert",
		"imageUrl = :img",
	);
	values[":title"] = article.metadata.title;
	values[":siteName"] = article.metadata.siteName;
	values[":excerpt"] = article.metadata.excerpt;
	values[":wordCount"] = article.metadata.wordCount;
	values[":ert"] = article.estimatedReadTime;
	values[":img"] = article.metadata.imageUrl ?? null;
}

function appendFreshnessClauses(
	article: Article,
	sets: string[],
	values: Record<string, unknown>,
): void {
	sets.push(
		"contentFetchedAt = :cfa",
		"etag = :etag",
		"lastModified = :lm",
		"canonicalContentHash = :cch",
	);
	values[":cfa"] = article.freshness.contentFetchedAt;
	values[":etag"] = article.freshness.etag ?? null;
	values[":lm"] = article.freshness.lastModified ?? null;
	values[":cch"] = article.freshness.canonicalContentHash ?? null;
}

function appendSummaryClauses(
	article: Article,
	sets: string[],
	removes: string[],
	values: Record<string, unknown>,
): void {
	sets.push("summaryStatus = :summaryStatus");
	if (article.summary.kind === "pending") {
		sets.push("summaryPendingSince = :summaryPendingSince");
		values[":summaryStatus"] = "pending";
		values[":summaryPendingSince"] = article.summary.pendingSince;
		removes.push(
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
		sets.push(
			"summary = :summary",
			"summaryExcerpt = :summaryExcerpt",
			"summaryInputTokens = :summaryInputTokens",
			"summaryOutputTokens = :summaryOutputTokens",
			"summarySourceContentHash = :summarySourceContentHash",
		);
		values[":summaryStatus"] = "ready";
		values[":summary"] = article.summary.summary;
		values[":summaryExcerpt"] = article.summary.excerpt ?? null;
		values[":summaryInputTokens"] = article.summary.inputTokens ?? null;
		values[":summaryOutputTokens"] = article.summary.outputTokens ?? null;
		values[":summarySourceContentHash"] = article.summary.sourceContentHash ?? null;
		removes.push(
			"summaryFailureReason",
			"summarySkippedReason",
			"summaryPendingSince",
			"summaryStage",
		);
		return;
	}
	if (article.summary.kind === "failed") {
		sets.push("summaryFailureReason = :summaryFailureReason");
		values[":summaryStatus"] = "failed";
		values[":summaryFailureReason"] = JSON.stringify(article.summary.reason);
		removes.push("summarySkippedReason", "summaryPendingSince", "summaryStage");
		return;
	}
	values[":summaryStatus"] = "skipped";
	if (article.summary.reason) {
		sets.push("summarySkippedReason = :summarySkippedReason");
		values[":summarySkippedReason"] = article.summary.reason;
	} else {
		removes.push("summarySkippedReason");
	}
	removes.push("summaryFailureReason", "summaryPendingSince", "summaryStage");
}

function appendCrawlClauses(
	article: Article,
	sets: string[],
	removes: string[],
	values: Record<string, unknown>,
): void {
	sets.push("crawlStatus = :crawlStatus");
	if (article.crawl.kind === "failed") {
		sets.push("crawlFailureReason = :crawlFailureReason");
		values[":crawlStatus"] = "failed";
		values[":crawlFailureReason"] = JSON.stringify(article.crawl.reason);
		removes.push(
			"crawlUnsupportedReason",
			"crawlPendingSince",
			"partialContent",
			"partialContentVersion",
		);
		return;
	}
	if (article.crawl.kind === "unsupported") {
		sets.push("crawlUnsupportedReason = :crawlUnsupportedReason");
		values[":crawlStatus"] = "unsupported";
		values[":crawlUnsupportedReason"] = JSON.stringify(article.crawl.reason);
		removes.push(
			"crawlFailureReason",
			"crawlPendingSince",
			"partialContent",
			"partialContentVersion",
		);
		return;
	}
	if (article.crawl.kind === "ready") {
		values[":crawlStatus"] = "ready";
		removes.push(
			"crawlFailureReason",
			"crawlUnsupportedReason",
			"crawlFailedAt",
			"crawlPendingSince",
			"partialContent",
			"partialContentVersion",
		);
		return;
	}
	sets.push("crawlPendingSince = :crawlPendingSince");
	values[":crawlStatus"] = "pending";
	values[":crawlPendingSince"] = article.crawl.pendingSince;
	removes.push("crawlFailureReason", "crawlUnsupportedReason");
}

function appendSummaryAutoHealClauses(
	article: Article,
	sets: string[],
	removes: string[],
	values: Record<string, unknown>,
): void {
	sets.push("summaryAutoHealAttempts = :summaryAutoHealAttempts");
	values[":summaryAutoHealAttempts"] = article.summaryAutoHeal.attempts;
	if (article.summaryAutoHeal.lastAttemptAt !== undefined) {
		sets.push("summaryAutoHealLastAttemptAt = :summaryAutoHealLastAttemptAt");
		values[":summaryAutoHealLastAttemptAt"] =
			article.summaryAutoHeal.lastAttemptAt;
	} else {
		removes.push("summaryAutoHealLastAttemptAt");
	}
}

function buildSaveCommand(params: {
	article: Article;
	transitionName: string;
	writes: readonly AggregateField[];
}): {
	UpdateExpression: string;
	ExpressionAttributeValues: Record<string, unknown>;
} {
	const sets: string[] = ["aggregateTransitionName = :atn"];
	const removes: string[] = [];
	const values: Record<string, unknown> = {
		":atn": params.transitionName,
	};

	const writesSet = new Set<AggregateField>(params.writes);
	if (writesSet.has("metadata")) {
		appendMetadataClauses(params.article, sets, values);
	}
	/* c8 ignore start -- V8 block-coverage phantom on the call expression, see bcoe/c8#319 */
	if (writesSet.has("freshness")) {
		appendFreshnessClauses(params.article, sets, values);
	}
	/* c8 ignore stop */
	if (writesSet.has("summary")) {
		appendSummaryClauses(params.article, sets, removes, values);
	}
	if (writesSet.has("crawl")) {
		appendCrawlClauses(params.article, sets, removes, values);
	}
	if (writesSet.has("summaryAutoHeal")) {
		appendSummaryAutoHealClauses(params.article, sets, removes, values);
	}

	const setClause = `SET ${sets.join(", ")}`;
	const removeClause = removes.length > 0 ? ` REMOVE ${removes.join(", ")}` : "";
	const UpdateExpression = setClause + removeClause;
	return { UpdateExpression, ExpressionAttributeValues: values };
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
				{ projection: AGGREGATE_FIELDS },
			);
			if (!row) return undefined;
			return rowToArticle(url, row);
		},
		save: async ({ article, transitionName, writes }) => {
			const articleResourceUniqueId = ArticleResourceUniqueId.parse(article.url);
			const { UpdateExpression, ExpressionAttributeValues } = buildSaveCommand({
				article,
				transitionName,
				writes,
			});
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression,
				ExpressionAttributeValues,
			});
		},
	};

	return { store };
}
