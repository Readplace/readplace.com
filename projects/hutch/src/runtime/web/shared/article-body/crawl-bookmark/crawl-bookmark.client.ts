export interface CrawlBookmarkDeps {
	document: Document;
	isNarrow: () => boolean;
	addSwapListener: (cb: (swapTarget: ParentNode) => void) => void;
}

export function initCrawlBookmark(deps: CrawlBookmarkDeps): { attach(): void } {
	function syncFrom(root: ParentNode): void {
		const bookmark = root.querySelector(".crawl-bookmark");
		if (bookmark === null) return;
		bookmark.classList.add("crawl-bookmark--js");
		if (deps.isNarrow()) {
			bookmark.removeAttribute("open");
		} else {
			bookmark.setAttribute("open", "");
		}
	}

	function attach(): void {
		syncFrom(deps.document);
		deps.addSwapListener(syncFrom);
	}

	return { attach };
}
