export function workerControlsPage(): boolean {
	return navigator.serviceWorker.controller !== null;
}

export async function offlineCacheHolds(input: { cacheName: string; keys: string[] }): Promise<boolean[]> {
	const cache = await caches.open(input.cacheName);
	const hits = await Promise.all(input.keys.map((key) => cache.match(key)));
	return hits.map((hit) => hit !== undefined);
}

export function pinBrowserOnline(): void {
	Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => true });
}

export function browserReportsOnline(): boolean {
	return navigator.onLine;
}

export function offlineCacheNames(): Promise<string[]> {
	return caches.keys();
}

export async function offlineWorkerCount(): Promise<number> {
	return (await navigator.serviceWorker.getRegistrations()).length;
}

export async function offlineCachesNamed(prefix: string): Promise<string[]> {
	return (await caches.keys()).filter((name) => name.startsWith(prefix));
}

export function recordHistoryTraversals(): void {
	let traversals = 0;
	window.addEventListener("popstate", () => {
		traversals += 1;
		document.documentElement.setAttribute("data-test-history-traversals", String(traversals));
	});
}

export function recordBannerTexts(): void {
	const root = document.documentElement;
	for (const banner of document.querySelectorAll(".offline-banner")) {
		const shown = new Set([banner.textContent]);
		root.setAttribute("data-test-banner-texts", [...shown].join(" | "));
		new MutationObserver(() => {
			shown.add(banner.textContent);
			root.setAttribute("data-test-banner-texts", [...shown].join(" | "));
		}).observe(banner, { childList: true, characterData: true, subtree: true });
	}
}

export function nextFailedRequestIsBackground(): Promise<boolean> {
	return new Promise((resolve) => {
		document.addEventListener(
			"htmx:sendError",
			(event) => resolve(event.target instanceof Element && event.target.hasAttribute("data-background-request")),
			{ once: true },
		);
	});
}

export async function offlineCopySavedAt(input: { cacheName: string; key: string; header: string }): Promise<string | null> {
	const copy = await (await caches.open(input.cacheName)).match(input.key);
	return copy === undefined ? null : copy.headers.get(input.header);
}

export function crawlDrawerRows(): string[] {
	return Array.from(document.querySelectorAll(".crawl-bookmark__tab"), (tab) =>
		String(tab.getAttribute("data-test-crawl-bookmark-tab")),
	);
}
