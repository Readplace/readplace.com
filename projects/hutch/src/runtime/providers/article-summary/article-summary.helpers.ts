import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { truncateAtWordBoundary } from "@packages/web-shell";

export interface PickedExcerpt {
	text: string;
	source: "generated" | "parsed";
}

export function pickExcerpt(
	summary: GeneratedSummary | undefined,
	fallback: string,
): PickedExcerpt {
	if (summary?.status === "ready" && summary.excerpt)
		return { text: summary.excerpt, source: "generated" };
	return { text: fallback, source: "parsed" };
}

const SEO_DESCRIPTION_MAX_CHARS = 160;

export function truncateForSeo(
	text: string,
	maxChars: number = SEO_DESCRIPTION_MAX_CHARS,
): string {
	return truncateAtWordBoundary(text, maxChars);
}
