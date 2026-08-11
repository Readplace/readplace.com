import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";

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

export function truncateAtWordBoundary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const slice = text.slice(0, maxChars - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}

export function truncateForSeo(
	text: string,
	maxChars: number = SEO_DESCRIPTION_MAX_CHARS,
): string {
	return truncateAtWordBoundary(text, maxChars);
}
