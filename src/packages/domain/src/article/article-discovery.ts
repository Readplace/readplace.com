import { articleDestinationHost } from "./article-site";
import type { SavedArticle } from "./article.types";
import { displayableReadTime } from "./displayable-read-time";

const DAY_MS = 24 * 60 * 60 * 1000;

export const READ_TIME_BUCKETS = [
	{ id: "under-5", label: "Under 5 min", belowMinutes: 5 },
	{ id: "5-10", label: "5–10 min", minMinutes: 5, belowMinutes: 10 },
	{ id: "10-20", label: "10–20 min", minMinutes: 10, belowMinutes: 20 },
	{ id: "20-plus", label: "20+ min", minMinutes: 20 },
] as const;

export type ReadTimeBucketId = (typeof READ_TIME_BUCKETS)[number]["id"];

export const SAVED_WINDOWS = [
	{ id: "today", label: "Today", withinMs: DAY_MS },
	{ id: "week", label: "This week", withinMs: 7 * DAY_MS },
	{ id: "month", label: "This month", withinMs: 30 * DAY_MS },
	{ id: "older", label: "Older", olderThanMs: 30 * DAY_MS },
] as const;

export type SavedWindowId = (typeof SAVED_WINDOWS)[number]["id"];

interface MinutesRange {
	minMinutes?: number;
	belowMinutes?: number;
}

interface SavedAtRange {
	from?: Date;
	before?: Date;
}

export interface ArticleDiscoveryQuery {
	terms: readonly string[];
	readTimeRanges: readonly MinutesRange[];
	savedAtRanges: readonly SavedAtRange[];
}

interface ArticleDiscoveryCandidate {
	title: string;
	siteLabel: string;
	destinationHost: string;
	readTimeMinutes: number | undefined;
	savedAt: Date;
}

function normalizeForSearch(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function searchTerms(q: string | undefined): string[] {
	if (q === undefined) return [];
	return normalizeForSearch(q).split(/\s+/).filter((term) => term.length > 0);
}

function savedAtRangeOf(window: (typeof SAVED_WINDOWS)[number], now: Date): SavedAtRange {
	if ("olderThanMs" in window) return { before: new Date(now.getTime() - window.olderThanMs) };
	return { from: new Date(now.getTime() - window.withinMs) };
}

export function resolveArticleDiscovery(input: {
	q?: string;
	time: readonly ReadTimeBucketId[];
	saved: readonly SavedWindowId[];
	now: Date;
}): ArticleDiscoveryQuery {
	return {
		terms: searchTerms(input.q),
		readTimeRanges: READ_TIME_BUCKETS.filter((bucket) => input.time.includes(bucket.id)),
		savedAtRanges: SAVED_WINDOWS.filter((window) => input.saved.includes(window.id)).map((window) =>
			savedAtRangeOf(window, input.now),
		),
	};
}

function matchesTerms(candidate: ArticleDiscoveryCandidate, terms: readonly string[]): boolean {
	if (terms.length === 0) return true;
	const haystack = normalizeForSearch(
		[candidate.title, candidate.siteLabel, candidate.destinationHost].join("\n"),
	);
	return terms.every((term) => haystack.includes(term));
}

function matchesReadTime(minutes: number | undefined, ranges: readonly MinutesRange[]): boolean {
	if (ranges.length === 0) return true;
	if (minutes === undefined) return false;
	return ranges.some(
		(range) =>
			(range.minMinutes === undefined || minutes >= range.minMinutes) &&
			(range.belowMinutes === undefined || minutes < range.belowMinutes),
	);
}

function matchesSavedAt(savedAt: Date, ranges: readonly SavedAtRange[]): boolean {
	if (ranges.length === 0) return true;
	return ranges.some(
		(range) =>
			(range.from === undefined || savedAt >= range.from) &&
			(range.before === undefined || savedAt < range.before),
	);
}

export function matchesArticleDiscovery(
	candidate: ArticleDiscoveryCandidate,
	query: ArticleDiscoveryQuery,
): boolean {
	return (
		matchesTerms(candidate, query.terms) &&
		matchesReadTime(candidate.readTimeMinutes, query.readTimeRanges) &&
		matchesSavedAt(candidate.savedAt, query.savedAtRanges)
	);
}

export function discoveryCandidateOf(article: SavedArticle): ArticleDiscoveryCandidate {
	return {
		title: article.metadata.title,
		siteLabel: article.metadata.siteName,
		destinationHost: articleDestinationHost(article.destinationUrl),
		readTimeMinutes: displayableReadTime(article) === undefined ? undefined : article.estimatedReadTime,
		savedAt: article.savedAt,
	};
}
