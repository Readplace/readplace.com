export const MAX_CRAWL_VERSIONS = 10;

export function appendCrawlVersion(
	existing: readonly string[],
	minuteId: string,
): { changed: boolean; next: string[] } {
	if (existing.includes(minuteId)) {
		return { changed: false, next: [...existing] };
	}
	return { changed: true, next: [minuteId, ...existing].slice(0, MAX_CRAWL_VERSIONS) };
}
