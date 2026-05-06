import {
	type SummarySkipReason,
	SummarySkipReasonSchema,
} from "@packages/article-state-types";

const SUMMARY_SKIP_MESSAGES: Record<SummarySkipReason, string> = {
	"content-too-short": "This article is too short to summarise.",
	"ai-unavailable":
		"Our summariser couldn't produce a useful summary for this article.",
};

const SUMMARY_SKIP_FALLBACK = "No summary was generated for this article.";

export function messageForSkip(reason: string | undefined): string {
	if (!reason) return SUMMARY_SKIP_FALLBACK;
	const known = SummarySkipReasonSchema.safeParse(reason);
	return known.success ? SUMMARY_SKIP_MESSAGES[known.data] : SUMMARY_SKIP_FALLBACK;
}
