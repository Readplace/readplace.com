import {
	MAX_EXCERPT_LENGTH,
	type GeneratedSummary,
} from "@packages/provider-contracts/article-summary";
import { truncateAtWordBoundary } from "../providers/article-summary/article-summary.helpers";

/** Size the preview like the article's own excerpt so the digest teases rather
 * than reprints: the excerpt's maximum length, plus a buffer that lets the
 * summary fallback run a little longer than a bare excerpt would. */
const PREVIEW_CHAR_BUFFER = 100;
const PREVIEW_MAX_CHARS = MAX_EXCERPT_LENGTH + PREVIEW_CHAR_BUFFER;

/** The digest teaser: prefer the article's own excerpt; fall back to the
 * summary truncated to the excerpt-sized budget. Empty string when no summary
 * is ready, so the caller renders a card with no body. Plain text either way —
 * the summary is stored as prose, and the template escapes it at render time. */
export function buildDigestPreview(summary: GeneratedSummary | undefined): string {
	if (summary?.status !== "ready") return "";
	if (summary.excerpt) return summary.excerpt.replace(/\s+/g, " ").trim();
	const flattened = summary.summary.replace(/\s+/g, " ").trim();
	return truncateAtWordBoundary(flattened, PREVIEW_MAX_CHARS);
}
