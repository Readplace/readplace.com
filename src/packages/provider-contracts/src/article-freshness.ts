import type { ParseArticleResult } from "@packages/article-parser";

export type ContentFreshnessResult =
	| { action: "new" }
	| { action: "skip" }
	| { action: "unchanged" }
	| { action: "refreshed"; article: ParseArticleResult & { ok: true } };

export type RefreshArticleIfStale = (params: {
	url: string;
}) => Promise<ContentFreshnessResult>;
