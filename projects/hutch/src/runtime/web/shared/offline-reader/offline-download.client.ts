import {
	OFFLINE_CACHE_NAME,
	OFFLINE_SOURCE_HEADER,
	isFreshOfflineCopy,
	offlineCacheKey,
	withoutCampaignParams,
} from "./offline-cache";

export { stampOfflineCopy } from "./offline-cache";

export interface DownloadResponse {
	status: number;
	ok: boolean;
	redirected: boolean;
	headers: { get(name: string): string | null };
	text(): Promise<string>;
	clone(): DownloadResponse;
}

interface DownloadCache {
	match(key: string, options: { ignoreVary: true }): Promise<DownloadResponse | undefined>;
	put(key: string, response: DownloadResponse): Promise<void>;
	delete(key: string): Promise<boolean>;
}

const LISTING_REQUEST = { credentials: "same-origin", headers: { Accept: "text/html" } } as const;
const ARTICLE_REQUEST = {
	credentials: "same-origin",
	headers: { Purpose: "prefetch", Accept: "text/html" },
} as const;
const IMAGE_REQUEST = { mode: "cors", credentials: "omit" } as const;

export type DownloadRequest = typeof LISTING_REQUEST | typeof ARTICLE_REQUEST | typeof IMAGE_REQUEST;

export interface OfflineDownloadDeps {
	document: Document;
	fetchFn: (url: string, init: DownloadRequest) => Promise<DownloadResponse>;
	caches: { open(name: string): Promise<DownloadCache> } | undefined;
	parseHtml: (html: string) => Document;
	addSettleListener: (listener: () => void) => void;
	now: () => number;
	stampCopy: (response: DownloadResponse, savedAt: number) => DownloadResponse;
}

const READY_ATTR = "data-offline-download-ready";
const CONTROL_ATTR = "data-offline-download";
const START = "[data-offline-download-start]";
const PROGRESS = "[data-offline-download-progress]";
const STATUS = "[data-offline-download-status]";
const READER_LINKS = "main .readlist-article__title[href]";
const NEXT_PAGE = "main nav.pagination a[rel='next'][href]";
const ARTICLE_IMAGES = "[data-article-body] img, [data-article-body] picture source";
const STILL_GENERATING = "#article-body-reader-slot[hx-get], #article-body-summary-slot[hx-get]";
const LISTING_UNAVAILABLE = "Couldn't load your unread articles";

interface DownloadState {
	running: boolean;
	started: boolean;
	done: number;
	total: number;
	status: string;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function pick<T extends Element = Element>(within: ParentNode, selector: string): T {
	const element = within.querySelector<T>(selector);
	assert(element, `the offline download control must hold ${selector}`);
	return element;
}

function attribute(element: Element, name: string): string {
	const value = element.getAttribute(name);
	assert(value !== null, `an element picked by ${name} always carries it`);
	return value;
}

function count(value: number): string {
	return value.toLocaleString("en-US");
}

function finishedStatus(input: { total: number; notReady: number }): string {
	const available = `${count(input.total - input.notReady)} available offline`;
	return input.notReady === 0 ? available : `${available}, ${count(input.notReady)} not ready`;
}

function isWholePage(response: DownloadResponse): boolean {
	return response.status === 200 && !response.redirected;
}

function srcsetUrls(srcset: string): string[] {
	const urls: string[] = [];
	let rest = srcset.replace(/^[\s,]+/, "");
	while (rest !== "") {
		const candidate = rest.split(/\s/, 1)[0];
		rest = rest.slice(candidate.length);
		if (candidate.endsWith(",")) {
			urls.push(candidate.replace(/,+$/, ""));
		} else {
			urls.push(candidate);
			const descriptorsEnd = rest.indexOf(",");
			rest = descriptorsEnd === -1 ? "" : rest.slice(descriptorsEnd + 1);
		}
		rest = rest.replace(/^[\s,]+/, "");
	}
	return urls;
}

function imageSources(readerPage: Document): Set<string> {
	const sources = new Set<string>();
	for (const image of readerPage.querySelectorAll(ARTICLE_IMAGES)) {
		const src = image.getAttribute("src");
		if (src) sources.add(src);
		const srcset = image.getAttribute("srcset");
		if (srcset) for (const candidate of srcsetUrls(srcset)) sources.add(candidate);
	}
	return sources;
}

export function initOfflineDownload(deps: OfflineDownloadDeps): void {
	if (deps.caches === undefined) return;
	const storage = deps.caches;
	const root = deps.document.documentElement;
	if (root.hasAttribute(READY_ATTR)) return;
	root.setAttribute(READY_ATTR, "");

	const state: DownloadState = { running: false, started: false, done: 0, total: 1, status: "" };

	function paint(): void {
		for (const control of deps.document.querySelectorAll<HTMLElement>(`[${CONTROL_ATTR}]`)) {
			pick<HTMLButtonElement>(control, START).disabled = state.running;
			const progress = pick<HTMLProgressElement>(control, PROGRESS);
			progress.hidden = !state.started;
			progress.max = Math.max(state.total, 1);
			progress.value = state.done;
			pick(control, STATUS).textContent = state.status;
		}
	}

	async function freshMatch(cache: DownloadCache, key: string): Promise<DownloadResponse | undefined> {
		const copy = await cache.match(key, { ignoreVary: true });
		if (copy === undefined || isFreshOfflineCopy(copy, deps.now())) return copy;
		await cache.delete(key);
		return undefined;
	}

	function keep(cache: DownloadCache, key: string, copy: DownloadResponse): Promise<void> {
		return cache.put(key, deps.stampCopy(copy, deps.now()));
	}

	async function unreadArticles(cache: DownloadCache, listing: URL): Promise<URL[]> {
		const articles = new Map<string, URL>();
		let page: URL | undefined = listing;
		while (page) {
			const response = await deps.fetchFn(page.href, LISTING_REQUEST);
			if (!isWholePage(response)) throw new Error(`the unread listing at ${page.href} answered ${response.status}`);
			await keep(cache, offlineCacheKey(page), response.clone());
			const listingPage = deps.parseHtml(await response.text());
			for (const link of listingPage.querySelectorAll(READER_LINKS)) {
				const article = withoutCampaignParams(new URL(attribute(link, "href"), page));
				articles.set(offlineCacheKey(article), article);
			}
			const next = listingPage.querySelector(NEXT_PAGE);
			page = next ? withoutCampaignParams(new URL(attribute(next, "href"), page)) : undefined;
		}
		return Array.from(articles.values());
	}

	async function keepImage(cache: DownloadCache, input: { source: string; article: URL }): Promise<void> {
		try {
			const image = new URL(input.source, input.article).href;
			const held = await freshMatch(cache, image);
			const response = held ?? (await deps.fetchFn(image, IMAGE_REQUEST));
			if (response.ok) await keep(cache, image, response);
		} catch {
			return;
		}
	}

	async function currentCopy(cache: DownloadCache, article: URL): Promise<Document | undefined> {
		const stored = await freshMatch(cache, offlineCacheKey(article));
		if (stored === undefined) return undefined;
		const source = new URL(String(stored.headers.get(OFFLINE_SOURCE_HEADER)), article);
		if (withoutCampaignParams(source).href !== article.href) return undefined;
		await keep(cache, offlineCacheKey(article), stored.clone());
		return deps.parseHtml(await stored.text());
	}

	async function freshCopy(cache: DownloadCache, article: URL): Promise<Document | undefined> {
		const response = await deps.fetchFn(article.href, ARTICLE_REQUEST);
		if (!isWholePage(response)) return undefined;
		const copy = response.clone();
		const readerPage = deps.parseHtml(await response.text());
		if (readerPage.querySelector(STILL_GENERATING) !== null) return undefined;
		await keep(cache, offlineCacheKey(article), copy);
		return readerPage;
	}

	async function keepArticle(cache: DownloadCache, article: URL): Promise<boolean> {
		try {
			const readerPage = (await currentCopy(cache, article)) ?? (await freshCopy(cache, article));
			if (readerPage === undefined) return false;
			for (const source of imageSources(readerPage)) await keepImage(cache, { source, article });
			return true;
		} catch {
			return false;
		}
	}

	async function download(listingHref: string): Promise<string> {
		const cache = await storage.open(OFFLINE_CACHE_NAME);
		const articles = await unreadArticles(cache, new URL(listingHref, deps.document.baseURI));
		Object.assign(state, { started: true, done: 0, total: articles.length });
		let notReady = 0;
		for (const article of articles) {
			state.status = `Downloading ${count(state.done + 1)} of ${count(state.total)}`;
			paint();
			if (!(await keepArticle(cache, article))) notReady += 1;
			state.done += 1;
		}
		return finishedStatus({ total: state.total, notReady });
	}

	function start(listingHref: string): void {
		Object.assign(state, { running: true, started: false, status: "" });
		paint();
		download(listingHref)
			.catch(() => LISTING_UNAVAILABLE)
			.then((status) => {
				Object.assign(state, { running: false, status });
				paint();
			});
	}

	deps.document.addEventListener("click", (event) => {
		const target = event.target;
		const button = isElement(target) ? target.closest(START) : null;
		if (button === null || state.running) return;
		const control = button.closest(`[${CONTROL_ATTR}]`);
		assert(control, "the download button always sits inside its control");
		start(attribute(control, CONTROL_ATTR));
	});

	deps.addSettleListener(paint);
	paint();
}
