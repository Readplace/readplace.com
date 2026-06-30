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
