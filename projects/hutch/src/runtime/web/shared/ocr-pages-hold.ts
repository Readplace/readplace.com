import { CrawlUnsupportedReasonSchema } from "@packages/article-state-types";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";

export type OcrPagesHold = NonNullable<SavedArticle["ocrPagesHold"]>;

function isAwaitingReader(rawReason: string): boolean {
	if (!rawReason.startsWith("{")) return false;
	return CrawlUnsupportedReasonSchema.safeParse(JSON.parse(rawReason)).data?.kind === "awaiting-reader";
}

export function shownOcrPagesHold(params: { hold: OcrPagesHold | undefined; crawl: ArticleCrawl | undefined }): OcrPagesHold | undefined {
	const { hold, crawl } = params;
	if (hold === undefined || crawl === undefined) return undefined;
	if (crawl.status === "pending") return hold;
	if (crawl.status === "unsupported" && isAwaitingReader(crawl.reason)) return hold;
	return undefined;
}
