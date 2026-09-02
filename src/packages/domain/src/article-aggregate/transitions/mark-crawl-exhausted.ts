import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlExhaustedInput {
	reason: CrawlFailureReason;
	receiveCount: number;
}

function reasonAsString(reason: CrawlFailureReason): string {
	switch (reason.kind) {
		case "parse-error":
			return `parse-error: ${reason.detail}`;
		case "fetch-failed":
			return reason.httpStatus !== undefined
				? `fetch-failed: HTTP ${reason.httpStatus}`
				: "fetch-failed";
		case "origin-unreachable":
			if (reason.httpStatus !== undefined)
				return `origin-unreachable: HTTP ${reason.httpStatus}`;
			if (reason.code !== undefined)
				return `origin-unreachable: ${reason.code}`;
			return "origin-unreachable";
		case "exhausted-retries":
			return "exhausted-retries";
		case "blocked":
			return `blocked: ${reason.cause}`;
		case "not-found":
			return `not-found: HTTP ${reason.httpStatus}`;
	}
}

export function markCrawlExhausted(
	article: Article,
	input: MarkCrawlExhaustedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	if (article.crawl.kind === "ready") {
		return { article, effects: [], writes: [] };
	}

	const writes: AggregateField[] = [];
	let crawl = article.crawl;
	if (article.crawl.kind === "pending") {
		crawl = { kind: "failed", reason: input.reason };
		writes.push("crawl");
	}
	let summary = article.summary;
	if (article.summary.kind === "pending") {
		summary = { kind: "failed", reason: { kind: "crawl-failed" } };
		writes.push("summary");
	}

	const reasonForEffect =
		article.crawl.kind === "failed" ? article.crawl.reason : input.reason;
	const effects: readonly Effect[] = [
		{
			kind: "publish-crawl-article-failed",
			url: article.url,
			reason: reasonAsString(reasonForEffect),
			receiveCount: input.receiveCount,
		},
	];
	return { article: { ...article, crawl, summary }, effects, writes };
}
