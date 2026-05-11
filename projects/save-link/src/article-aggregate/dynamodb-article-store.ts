import assert from "node:assert";
import {
	CrawlStatusSchema,
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
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";

/**
 * Row schema for the Article aggregate. Each attribute is `dynamoField`
 * because legacy rows may be missing any of these (pre-state-machine rows,
 * rows that were saved before a particular field existed). The aggregate
 * fills in defaults at the mapping boundary.
 *
 * Fields outside this schema (routeId, originalUrl, content, contentSourceTier)
 * are owned by separate writers and are *not* touched by the aggregate save —
 * the UpdateExpression below only writes the attributes the aggregate models.
 *
 * `aggregateTransitionName` is the Phase 2 canary tag: the name of the
 * transition function that last wrote this row through the aggregate. The
 * check-stuck-articles scan reads it to bucket stuck rows by migrated vs.
 * legacy writer; if a row produced by a migrated transition still shows up
 * stuck a week later, the aggregate hypothesis is wrong and Phase 3+ stops.
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
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlUnsupportedReason: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	summary: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	summaryInputTokens: dynamoField(z.number()),
	summaryOutputTokens: dynamoField(z.number()),
	summaryFailureReason: dynamoField(z.string()),
	summarySkippedReason: dynamoField(z.string()),
	aggregateTransitionName: dynamoField(z.string()),
});

type RowShape = z.infer<typeof ArticleAggregateRow>;

const AGGREGATE_FIELDS = ArticleAggregateRow.keyof().options;

function rowToCrawlState(row: RowShape): CrawlState {
	if (row.crawlStatus === "failed") {
		assert(
			row.crawlFailureReason,
			"crawlStatus=failed row must carry crawlFailureReason",
		);
		return { kind: "failed", reason: row.crawlFailureReason };
	}
	if (row.crawlStatus === "unsupported") {
		assert(
			row.crawlUnsupportedReason,
			"crawlStatus=unsupported row must carry crawlUnsupportedReason",
		);
		return { kind: "unsupported", reason: row.crawlUnsupportedReason };
	}
	if (row.crawlStatus === "ready") return { kind: "ready" };
	return { kind: "pending" };
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
		return ready;
	}
	if (row.summaryStatus === "failed") {
		assert(
			row.summaryFailureReason,
			"summaryStatus=failed row must carry summaryFailureReason",
		);
		return { kind: "failed", reason: row.summaryFailureReason };
	}
	if (row.summaryStatus === "skipped") {
		return row.summarySkippedReason
			? { kind: "skipped", reason: row.summarySkippedReason }
			: { kind: "skipped" };
	}
	return { kind: "pending" };
}

function rowToArticle(url: string, row: RowShape): Article {
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
		},
		estimatedReadTime: row.estimatedReadTime ?? 0,
		crawl: rowToCrawlState(row),
		summary: rowToSummaryState(row),
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
	);
	values[":cfa"] = article.freshness.contentFetchedAt;
	values[":etag"] = article.freshness.etag ?? null;
	values[":lm"] = article.freshness.lastModified ?? null;
}

function appendSummaryClauses(
	article: Article,
	sets: string[],
	removes: string[],
	values: Record<string, unknown>,
): void {
	sets.push("summaryStatus = :summaryStatus");
	if (article.summary.kind === "pending") {
		values[":summaryStatus"] = "pending";
		removes.push(
			"summary",
			"summaryExcerpt",
			"summaryInputTokens",
			"summaryOutputTokens",
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
		);
		values[":summaryStatus"] = "ready";
		values[":summary"] = article.summary.summary;
		values[":summaryExcerpt"] = article.summary.excerpt ?? null;
		values[":summaryInputTokens"] = article.summary.inputTokens ?? null;
		values[":summaryOutputTokens"] = article.summary.outputTokens ?? null;
		removes.push("summaryFailureReason", "summarySkippedReason");
		return;
	}
	if (article.summary.kind === "failed") {
		sets.push("summaryFailureReason = :summaryFailureReason");
		values[":summaryStatus"] = "failed";
		values[":summaryFailureReason"] = article.summary.reason;
		removes.push("summarySkippedReason");
		return;
	}
	values[":summaryStatus"] = "skipped";
	if (article.summary.reason) {
		sets.push("summarySkippedReason = :summarySkippedReason");
		values[":summarySkippedReason"] = article.summary.reason;
	} else {
		removes.push("summarySkippedReason");
	}
	removes.push("summaryFailureReason");
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
		values[":crawlFailureReason"] = article.crawl.reason;
		removes.push("crawlUnsupportedReason");
		return;
	}
	if (article.crawl.kind === "unsupported") {
		sets.push("crawlUnsupportedReason = :crawlUnsupportedReason");
		values[":crawlStatus"] = "unsupported";
		values[":crawlUnsupportedReason"] = article.crawl.reason;
		removes.push("crawlFailureReason");
		return;
	}
	if (article.crawl.kind === "ready") {
		values[":crawlStatus"] = "ready";
		removes.push("crawlFailureReason", "crawlUnsupportedReason", "crawlFailedAt");
		return;
	}
	values[":crawlStatus"] = "pending";
	removes.push("crawlFailureReason", "crawlUnsupportedReason");
}

/**
 * Build the UpdateExpression scoped to the aggregate fields this transition
 * actually mutated. The `writes` set is the transition's promise to the
 * storage adapter: any field not in `writes` is left untouched on the row,
 * so a concurrent inline writer on a different axis is never clobbered by
 * an aggregate save it didn't intend to.
 *
 * `aggregateTransitionName` is written on every save regardless of `writes`
 * — it is the canary tag, not a domain field, and a non-Phase-2 transition
 * (refreshContent) writing `"refreshContent"` is correct.
 */
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
	if (writesSet.has("freshness")) {
		appendFreshnessClauses(params.article, sets, values);
	}
	if (writesSet.has("summary")) {
		appendSummaryClauses(params.article, sets, removes, values);
	}
	if (writesSet.has("crawl")) {
		appendCrawlClauses(params.article, sets, removes, values);
	}

	const setClause = `SET ${sets.join(", ")}`;
	const removeClause = removes.length > 0 ? ` REMOVE ${removes.join(", ")}` : "";
	const UpdateExpression = setClause + removeClause;
	/* c8 ignore next -- V8 block-coverage phantom on the final assignment, see bcoe/c8#319 */
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
