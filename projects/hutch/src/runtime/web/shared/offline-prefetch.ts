const OFFLINE_RESOLVING_LISTING_PAGES = 2;

export function isOfflinePrefetchPage(pageNumber: number): boolean {
	return pageNumber > OFFLINE_RESOLVING_LISTING_PAGES;
}
