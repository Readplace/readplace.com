/**
 * Prepend a dated crawl version onto the row's log, newest first. The log is
 * intentionally append-only and unbounded: every content-changing crawl is kept
 * forever so a later, larger reader limit — or a dedicated "all versions" page —
 * can reach the full history (the S3 snapshots it indexes are likewise never
 * pruned). The reader bookmark decides how many of these to surface. Re-recording
 * a minute already present is a no-op.
 */
export function appendCrawlVersion(
	existing: readonly string[],
	minuteId: string,
): { changed: boolean; next: string[] } {
	if (existing.includes(minuteId)) {
		return { changed: false, next: [...existing] };
	}
	return { changed: true, next: [minuteId, ...existing] };
}
