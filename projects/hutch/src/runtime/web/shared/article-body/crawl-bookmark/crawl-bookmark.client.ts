interface CrawlBookmarkStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface CrawlBookmarkDeps {
	document: Document;
	isNarrow: () => boolean;
	storage: CrawlBookmarkStorage;
	addSwapListener: (cb: (swapTarget: ParentNode) => void) => void;
}

const STORAGE_KEY = "readplace.crawl-bookmark-dismissed";

export function initCrawlBookmark(deps: CrawlBookmarkDeps): { attach(): void } {
	function readDismissed(): boolean {
		try {
			return deps.storage.getItem(STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	}

	function writeDismissed(): void {
		try {
			deps.storage.setItem(STORAGE_KEY, "1");
		} catch {}
	}

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
				if (!bookmark.hasAttribute("open")) writeDismissed();
			});
			bookmark.querySelector(".crawl-bookmark__handle")?.addEventListener("click", () => {
				const wasOpenBeforeNativeToggle = bookmark.hasAttribute("open");
				if (wasOpenBeforeNativeToggle) writeDismissed();
			});
		}
		if (readDismissed() || deps.isNarrow()) {
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
