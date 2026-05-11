import assert from "node:assert";
import {
	CrawlStatusSchema,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import type {
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

/**
 * Build the UpdateExpression that writes the aggregate fields refresh-content
 * mutates today. Only metadata, freshness, estimatedReadTime, and summary are
 * touched — crawl state is loaded into the aggregate for completeness but not
 * written back here, so a concurrent crawl-state writer cannot be clobbered
 * by an aggregate save in Phase 1.
 *
 * Summary fields are written based on the discriminant: a `pending` summary
 * REMOVEs every summary-detail attribute (mirroring the inline UpdateExpression
 * the aggregate replaces) so a row never sits in the inconsistent
 * (status=ready, summary text missing) state that left rows stuck on the
 * forever-polling "Generating summary…" panel.
 */
function buildSaveCommand(article: Article): {
	UpdateExpression: string;
	ExpressionAttributeValues: Record<string, unknown>;
} {
	const sets: string[] = [
		"title = :title",
		"siteName = :siteName",
		"excerpt = :excerpt",
		"wordCount = :wordCount",
		"estimatedReadTime = :ert",
		"contentFetchedAt = :cfa",
		"etag = :etag",
		"lastModified = :lm",
		"imageUrl = :img",
	];

	const values: Record<string, unknown> = {
		":title": article.metadata.title,
		":siteName": article.metadata.siteName,
		":excerpt": article.metadata.excerpt,
		":wordCount": article.metadata.wordCount,
		":ert": article.estimatedReadTime,
		":cfa": article.freshness.contentFetchedAt,
		":etag": article.freshness.etag ?? null,
		":lm": article.freshness.lastModified ?? null,
		":img": article.metadata.imageUrl ?? null,
	};

	const removes: string[] = [];

	if (article.summary.kind === "pending") {
		sets.push("summaryStatus = :summaryStatus");
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
	} else if (article.summary.kind === "ready") {
		sets.push("summaryStatus = :summaryStatus");
		sets.push("summary = :summary");
		values[":summaryStatus"] = "ready";
		values[":summary"] = article.summary.summary;
		sets.push("summaryExcerpt = :summaryExcerpt");
		values[":summaryExcerpt"] = article.summary.excerpt ?? null;
		sets.push("summaryInputTokens = :summaryInputTokens");
		values[":summaryInputTokens"] = article.summary.inputTokens ?? null;
		sets.push("summaryOutputTokens = :summaryOutputTokens");
		values[":summaryOutputTokens"] = article.summary.outputTokens ?? null;
		removes.push("summaryFailureReason", "summarySkippedReason");
	} else if (article.summary.kind === "failed") {
		sets.push("summaryStatus = :summaryStatus");
		sets.push("summaryFailureReason = :summaryFailureReason");
		values[":summaryStatus"] = "failed";
		values[":summaryFailureReason"] = article.summary.reason;
		removes.push("summarySkippedReason");
	} else {
		sets.push("summaryStatus = :summaryStatus");
		values[":summaryStatus"] = "skipped";
		if (article.summary.reason) {
			sets.push("summarySkippedReason = :summarySkippedReason");
			values[":summarySkippedReason"] = article.summary.reason;
		} else {
			removes.push("summarySkippedReason");
		}
		removes.push("summaryFailureReason");
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
		save: async (article) => {
			const articleResourceUniqueId = ArticleResourceUniqueId.parse(article.url);
			const { UpdateExpression, ExpressionAttributeValues } =
				buildSaveCommand(article);
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression,
				ExpressionAttributeValues,
			});
		},
	};

	return { store };
}
