import { CrawlUnsupportedReasonSchema, parseCrawlFailureReason } from "@packages/article-state-types";
import { isNonArticleHost, type ShownSummary } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";

export type ResolutionOnViewNeed = "crawl-and-summary" | "summary" | "device-first" | "none";

const RESUMABLE_SUMMARY_SKIPS: ReadonlySet<string> = new Set(["awaiting-reader", "ai-unavailable"]);

function isContentTooLarge(rawReason: string): boolean {
	if (!rawReason.startsWith("{")) return false;
	return CrawlUnsupportedReasonSchema.safeParse(JSON.parse(rawReason)).data?.kind === "content-too-large";
}

function failedCrawlNeed(rawReason: string, viewerCanCapture: boolean): ResolutionOnViewNeed {
	const reason = parseCrawlFailureReason(rawReason);
	if (reason?.kind === "not-found") return "none";
	if (reason?.kind !== "blocked") return "crawl-and-summary";
	if (reason.cause === "robots") return "none";
	if (reason.cause === "spend-capped") return "crawl-and-summary";
	return viewerCanCapture ? "device-first" : "crawl-and-summary";
}

function summaryNeed(summary: ShownSummary | undefined): ResolutionOnViewNeed {
	if (summary?.status === "failed") return "summary";
	if (summary?.status !== "skipped" || summary.reason === undefined) return "none";
	return RESUMABLE_SUMMARY_SKIPS.has(summary.reason) ? "summary" : "none";
}

export function needsResolutionOnView(params: {
	url: string;
	crawl: ArticleCrawl | undefined;
	summary: ShownSummary | undefined;
	viewerCanCapture: boolean;
}): ResolutionOnViewNeed {
	if (isNonArticleHost(params.url)) return "none";
	const { crawl } = params;
	if (crawl?.status === "failed") return failedCrawlNeed(crawl.reason, params.viewerCanCapture);
	if (crawl?.status === "unsupported") return isContentTooLarge(crawl.reason) ? "none" : "crawl-and-summary";
	if (crawl?.status === "ready") return summaryNeed(params.summary);
	return "none";
}
