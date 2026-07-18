import {
	type CrawlVersionEntry,
	type StoredCrawlVersion,
	normalizeCrawlVersion,
} from "@packages/article-store";

/**
 * Prepend a dated crawl version onto the row's log, newest first. The log is
 * intentionally append-only and unbounded: every content-changing crawl is kept
 * forever so a later, larger reader limit — or a dedicated "all versions" page —
 * can reach the full history (the S3 snapshots it indexes are likewise never
 * pruned). The reader bookmark decides how many of these to surface. Re-recording
 * a minute already present is a no-op. Existing entries pass through untouched
 * (legacy bare strings stay strings) so the caller's compare-and-swap condition
 * keeps comparing against exactly what it read.
 */
export function appendCrawlVersion(
	existing: readonly StoredCrawlVersion[],
	entry: CrawlVersionEntry,
): { changed: boolean; next: StoredCrawlVersion[] } {
	const alreadyRecorded = existing.some(
		(stored) => normalizeCrawlVersion(stored).minuteId === entry.minuteId,
	);
	if (alreadyRecorded) {
		return { changed: false, next: [...existing] };
	}
	return { changed: true, next: [entry, ...existing] };
}
