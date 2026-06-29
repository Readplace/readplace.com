/**
 * Collapses the "Last crawled at" bookmark on narrow viewports and opens it on
 * wide ones. The no-JS baseline ships `<details open>` so the tab is visible on
 * every device; this enhancer overrides that default per viewport. It re-runs
 * on every htmx swap so a boosted navigation keeps the per-viewport default,
 * and otherwise leaves the native <details> toggle to the reader.
 */
export interface CrawlBookmarkDeps {
	document: Document;
	isNarrow: () => boolean;
	addSwapListener: (cb: () => void) => void;
}

export function initCrawlBookmark(deps: CrawlBookmarkDeps): { attach(): void } {
	function sync(): void {
		const bookmark = deps.document.querySelector(".crawl-bookmark");
		if (bookmark === null) return;
		if (deps.isNarrow()) {
			bookmark.removeAttribute("open");
		} else {
			bookmark.setAttribute("open", "");
		}
	}

	function attach(): void {
		sync();
		deps.addSwapListener(sync);
	}

	return { attach };
}
