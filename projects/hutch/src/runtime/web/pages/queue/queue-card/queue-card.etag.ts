import { createHash } from "node:crypto";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";

export interface QueueCardEtagInput {
	article: SavedArticle;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
}

function hashFields(parts: readonly string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(part);
		hash.update("|");
	}
	return hash.digest("hex").slice(0, 16);
}

/**
 * Weak ETag composed of the row identity + every field that can mutate while
 * the card sits on screen. Crawl and summary status drive the obvious
 * transitions; wordCount goes 0 → real number when the crawl writes back; the
 * title/excerpt/imageUrl hash catches in-place re-summary regenerations and
 * the late-arriving S3 thumbnail copy that flips imageUrl after crawlStatus
 * is already "ready".
 *
 * `W/` prefix marks this weak — semantically equivalent representations may
 * share the tag (acceptable here since htmx never byte-compares responses).
 */
export function computeQueueCardEtag(input: QueueCardEtagInput): string {
	const { article, crawl, summary } = input;
	const summaryStatus = summary?.status ?? "absent";
	const crawlStatus = crawl?.status ?? "absent";
	const summaryReason =
		summary?.status === "failed" || summary?.status === "skipped"
			? (summary.reason ?? "")
			: "";
	const crawlReason = crawl?.status === "failed" ? crawl.reason : "";
	const contentHash = hashFields([
		article.metadata.title,
		article.metadata.excerpt,
		article.metadata.imageUrl ?? "",
		article.metadata.siteName,
	]);
	return `W/"${article.id.value}:${article.status}:${crawlStatus}:${summaryStatus}:${article.metadata.wordCount}:${contentHash}:${hashFields([crawlReason, summaryReason])}"`;
}

export function etagMatches(
	ifNoneMatchHeader: string | undefined,
	etag: string,
): boolean {
	if (!ifNoneMatchHeader) return false;
	return ifNoneMatchHeader
		.split(",")
		.map((part) => part.trim())
		.includes(etag);
}
