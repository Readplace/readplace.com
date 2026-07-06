export interface CrawlBookmarkDeps {
	document: Document;
	isNarrow: () => boolean;
	addSwapListener: (cb: (swapTarget: ParentNode) => void) => void;
}

export function initCrawlBookmark(deps: CrawlBookmarkDeps): { attach(): void } {
	function syncFrom(root: ParentNode): void {
		const bookmark = root.querySelector(".crawl-bookmark");
		if (bookmark === null) return;
		if (!bookmark.classList.contains("crawl-bookmark--js")) {
			bookmark.classList.add("crawl-bookmark--js");
			// The native <summary> only toggles from the handle; wire the info panel
			// to toggle too so a click anywhere on the capsule opens/closes it. Bound
			// once per element (guarded above) so a re-sync can't stack listeners.
			bookmark.querySelector(".crawl-bookmark__tabs")?.addEventListener("click", () => {
				bookmark.toggleAttribute("open");
			});
		}
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
