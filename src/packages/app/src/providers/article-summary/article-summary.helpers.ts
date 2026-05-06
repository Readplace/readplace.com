import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";

export function pickExcerpt(
	summary: GeneratedSummary | undefined,
	fallback: string,
): string {
	if (summary?.status === "ready" && summary.excerpt) return summary.excerpt;
	return fallback;
}

const SEO_DESCRIPTION_MAX_CHARS = 160;

export function truncateForSeo(
	text: string,
	maxChars: number = SEO_DESCRIPTION_MAX_CHARS,
): string {
	if (text.length <= maxChars) return text;
	const slice = text.slice(0, maxChars - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}
