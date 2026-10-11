import { SummarySkipReasonSchema } from "@packages/article-state-types";
import type { z } from "zod";

const CRAWL_VERDICT_REASONS = ["crawl-unsupported", "crawl-failed"] as const;
const CrawlVerdictSkipReasonSchema = SummarySkipReasonSchema.extract(CRAWL_VERDICT_REASONS);
const RenderedSkipReasonSchema = SummarySkipReasonSchema.exclude(CRAWL_VERDICT_REASONS);

const SUMMARY_SKIP_MESSAGES: Record<z.infer<typeof RenderedSkipReasonSchema>, string> = {
	"content-too-short": "This article is too short to generate a summary.",
	"ai-unavailable":
		"Readplace couldn't generate a useful summary for this article.",
	"declined":
		"Readplace couldn't generate a useful summary for this article.",
};

const SUMMARY_SKIP_FALLBACK = "No summary was generated for this article.";

export function messageForSkip(reason: string | undefined): string {
	if (!reason) return SUMMARY_SKIP_FALLBACK;
	const known = RenderedSkipReasonSchema.safeParse(reason);
	return known.success ? SUMMARY_SKIP_MESSAGES[known.data] : SUMMARY_SKIP_FALLBACK;
}

export function isCrawlVerdictSkip(reason: string | undefined): boolean {
	return CrawlVerdictSkipReasonSchema.safeParse(reason).success;
}
