import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";

/** The blob of text the resurface matcher reasons over for one article: the
 * generated summary when it is ready, otherwise the crawl excerpt. */
export function resurfaceCandidateText(params: {
	excerpt: string;
	summary: GeneratedSummary | undefined;
}): string {
	const { excerpt, summary } = params;
	if (summary?.status === "ready" && summary.summary) return summary.summary;
	return excerpt;
}
