import { sanitizeArticleHtml } from "@packages/domain/article";
import { stripHtml } from "../generate-summary/strip-html";

const MIN_SHARED_SENTENCES = 0.99;
const MAX_WORDS_LOST = 50;
const RENDERED_MEDIA_TAGS = ["img", "table"] as const;

function sentencesOf(text: string): string[] {
	return text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 0);
}

function countsOf(sentences: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const sentence of sentences) counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
	return counts;
}

function sharedSentences(params: { fresh: readonly string[]; canonical: readonly string[] }): number {
	const canonicalCounts = countsOf(params.canonical);
	let shared = 0;
	for (const [sentence, count] of countsOf(params.fresh)) shared += Math.min(count, canonicalCounts.get(sentence) ?? 0);
	return shared;
}

function wordsIn(text: string): number {
	return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function renderedCount(params: { rendered: string; tag: (typeof RENDERED_MEDIA_TAGS)[number] }): number {
	return [...params.rendered.matchAll(new RegExp(`<${params.tag}\\b`, "gi"))].length;
}

export function bodiesAreNearIdentical(params: { fresh: string; canonical: string }): boolean {
	const freshText = stripHtml(params.fresh);
	const canonicalText = stripHtml(params.canonical);
	const fresh = sentencesOf(freshText);
	const canonical = sentencesOf(canonicalText);
	const similarity = (2 * sharedSentences({ fresh, canonical })) / (fresh.length + canonical.length);
	if (!(similarity >= MIN_SHARED_SENTENCES)) return false;
	if (wordsIn(freshText) < wordsIn(canonicalText) - MAX_WORDS_LOST) return false;
	const freshRendered = sanitizeArticleHtml(params.fresh);
	const canonicalRendered = sanitizeArticleHtml(params.canonical);
	return RENDERED_MEDIA_TAGS.every((tag) => renderedCount({ rendered: freshRendered, tag }) >= renderedCount({ rendered: canonicalRendered, tag }));
}
