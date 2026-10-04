import type { ParseArticleResult } from "@packages/article-parser";

type FreshnessIdentity = { identity?: { url: string; contentSourceUrl?: string } };

export type ContentFreshnessResult = FreshnessIdentity &
	(
		| { action: "new" }
		| { action: "skip" }
		| { action: "unchanged" }
		| { action: "refreshed"; article: ParseArticleResult & { ok: true } }
	);

export type RefreshArticleIfStale = (params: {
	url: string;
}) => Promise<ContentFreshnessResult>;
