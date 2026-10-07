import { iconSvg } from "@packages/ui-icons";
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

export interface DownloadRunRecord {
	read(): string | null;
	write(record: string): void;
	clear(): void;
}

export interface OfflineDownloadDeps {
	document: Document;
	fetchFn: (url: string, init: DownloadRequest) => Promise<DownloadResponse>;
	caches: { open(name: string): Promise<DownloadCache> } | undefined;
	parseHtml: (html: string) => Document;
	addSettleListener: (listener: () => void) => void;
	addPageHideListener: (listener: () => void) => void;
	now: () => number;
	stampCopy: (response: DownloadResponse, savedAt: number) => DownloadResponse;
	runRecord: DownloadRunRecord;
}

const READY_ATTR = "data-offline-download-ready";
const CONTROL_ATTR = "data-offline-download";
const START = "[data-offline-download-start]";
const PROGRESS = "[data-offline-download-progress]";
const STATUS = "[data-offline-download-status]";
const READER_LINKS = "main .readlist-article__title[href]";
const CARD_TITLES = ".readlist-article__title[href]";
const CARD_META = ".readlist-article__meta";
const OFFLINE_TAG_ATTR = "data-offline-tag";
const KNOWN_TAB_TOTAL = "#readlist-count .readlist__count-value--known";
const NEXT_PAGE = "main nav.pagination a[rel='next'][href]";
const ARTICLE_IMAGES = "[data-article-body] img, [data-article-body] picture source";
const STILL_GENERATING = "#article-body-reader-slot[hx-get], #article-body-summary-slot[hx-get]";
const LISTING_UNAVAILABLE = "Couldn't load your unread articles";
const PREPARING = "Preparing download…";
const ARTICLES_IN_FLIGHT = 6;

interface DownloadState {
	running: boolean;
	started: boolean;
	done: number;
	total: number | undefined;
	status: string;
}

interface RunProgress {
	listing: string;
	kept: number;
	total: number;
}

class SignedOut extends Error {}

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

function knownTabTotal(document: Document): number | undefined {
	const total = Number.parseInt(document.querySelector(KNOWN_TAB_TOTAL)?.textContent ?? "", 10);
	return Number.isNaN(total) ? undefined : total;
}

function parseRunProgress(record: string | null): RunProgress | undefined {
	try {
		const parsed: unknown = JSON.parse(String(record));
		const listing = Reflect.get(Object(parsed), "listing");
		const kept = Reflect.get(Object(parsed), "kept");
		const total = Reflect.get(Object(parsed), "total");
		if (typeof listing !== "string" || typeof kept !== "number" || typeof total !== "number") return undefined;
		return { listing, kept, total };
	} catch {
		return undefined;
	}
}

function resumeStatus(progress: RunProgress): string {
	return `${count(progress.kept)} of ${count(progress.total)} downloaded. Press to continue.`;
}

function signedOutStatus(kept: number): string {
	const resume = kept === 0 ? "" : ` from ${count(kept)}`;
	return `You were signed out. Sign in and press again to continue${resume}.`;
}

export function initOfflineDownload(deps: OfflineDownloadDeps): void {
	if (deps.caches === undefined) return;
	const storage = deps.caches;
	const root = deps.document.documentElement;
	if (root.hasAttribute(READY_ATTR)) return;
	root.setAttribute(READY_ATTR, "");

	const state: DownloadState = { running: false, started: false, done: 0, total: 1, status: "" };
	const page = { leaving: false };

	function listingKeyOf(href: string): string {
		return offlineCacheKey(new URL(href, deps.document.baseURI));
	}

	function paint(): void {
		for (const control of deps.document.querySelectorAll<HTMLElement>(`[${CONTROL_ATTR}]`)) {
			pick<HTMLButtonElement>(control, START).disabled = state.running;
			const progress = pick<HTMLProgressElement>(control, PROGRESS);
			progress.hidden = !state.started;
			if (state.total === undefined) {
				progress.removeAttribute("value");
			} else {
				progress.max = Math.max(state.total, 1);
				progress.value = state.done;
			}
			pick(control, STATUS).textContent = state.status;
		}
	}

	function showUnfinishedRun(): void {
		const progress = parseRunProgress(deps.runRecord.read());
		if (progress === undefined) return;
		const controls = Array.from(deps.document.querySelectorAll(`[${CONTROL_ATTR}]`));
		if (!controls.some((control) => listingKeyOf(attribute(control, CONTROL_ATTR)) === progress.listing)) return;
		Object.assign(state, { started: true, done: progress.kept, total: progress.total, status: resumeStatus(progress) });
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

	function isCurrentCopy(stored: DownloadResponse, article: URL): boolean {
		const source = new URL(String(stored.headers.get(OFFLINE_SOURCE_HEADER)), article);
		return withoutCampaignParams(source).href === article.href;
	}

	function cardArticle(link: Element): URL {
		return withoutCampaignParams(new URL(attribute(link, "href"), deps.document.baseURI));
	}

	function tagCard(link: Element, available: boolean): void {
		const card = link.closest(".readlist-article");
		assert(card, "a card title always sits inside its card");
		const meta = card.querySelector(CARD_META);
		assert(meta, "every card carries its meta row");
		const tag = meta.querySelector(`[${OFFLINE_TAG_ATTR}]`);
		if (!available) {
			tag?.remove();
			return;
		}
		if (tag !== null) return;
		const created = deps.document.createElement("span");
		created.className = "chip chip--badge chip--success";
		created.setAttribute(OFFLINE_TAG_ATTR, "");
		created.textContent = "Saved offline";
		created.insertAdjacentHTML("beforeend", iconSvg("check"));
		meta.append(created);
	}

	async function tagCards(): Promise<void> {
		const cache = await storage.open(OFFLINE_CACHE_NAME);
		for (const link of deps.document.querySelectorAll(CARD_TITLES)) {
			const article = cardArticle(link);
			const stored = await cache.match(offlineCacheKey(article), { ignoreVary: true });
			tagCard(link, stored !== undefined && isFreshOfflineCopy(stored, deps.now()) && isCurrentCopy(stored, article));
		}
	}

	function tagKeptArticle(article: URL): void {
		for (const link of deps.document.querySelectorAll(CARD_TITLES)) {
			if (cardArticle(link).href === article.href) tagCard(link, true);
		}
	}

	async function walkListing(input: {
		cache: DownloadCache;
		listing: URL;
		found: (article: URL) => void;
		stopped: () => boolean;
	}): Promise<void> {
		let page: URL | undefined = input.listing;
		while (page && !input.stopped()) {
			const response = await deps.fetchFn(page.href, LISTING_REQUEST);
			if (response.redirected) throw new SignedOut();
			if (!isWholePage(response)) throw new Error(`the unread listing at ${page.href} answered ${response.status}`);
			await keep(input.cache, offlineCacheKey(page), response.clone());
			const listingPage = deps.parseHtml(await response.text());
			for (const link of listingPage.querySelectorAll(READER_LINKS)) {
				input.found(withoutCampaignParams(new URL(attribute(link, "href"), page)));
			}
			const next = listingPage.querySelector(NEXT_PAGE);
			page = next ? withoutCampaignParams(new URL(attribute(next, "href"), page)) : undefined;
		}
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
		if (stored === undefined || !isCurrentCopy(stored, article)) return undefined;
		await keep(cache, offlineCacheKey(article), stored.clone());
		return deps.parseHtml(await stored.text());
	}

	async function freshCopy(cache: DownloadCache, article: URL): Promise<Document | undefined> {
		const response = await deps.fetchFn(article.href, ARTICLE_REQUEST);
		if (response.redirected) throw new SignedOut();
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
			const images = Array.from(imageSources(readerPage), (source) => keepImage(cache, { source, article }));
			await Promise.all(images);
			return true;
		} catch (error) {
			if (error instanceof SignedOut) throw error;
			return false;
		}
	}

	async function download(listingHref: string): Promise<string> {
		const listing = new URL(listingHref, deps.document.baseURI);
		const headerTotal = knownTabTotal(deps.document);
		const queue: URL[] = [];
		const seen = new Set<string>();
		const waiting: Array<() => void> = [];
		const run: { walking: boolean; kept: number; notReady: number; failure: unknown } = {
			walking: true,
			kept: 0,
			notReady: 0,
			failure: undefined,
		};

		function wake(): void {
			for (const resume of waiting.splice(0)) resume();
		}

		function record(): void {
			deps.runRecord.write(
				JSON.stringify({ listing: offlineCacheKey(listing), kept: run.kept, total: state.total ?? seen.size }),
			);
		}

		function progressed(): void {
			if (state.total !== undefined) state.status = `Downloading ${count(state.done)} of ${count(state.total)}`;
			paint();
		}

		const cache = await storage.open(OFFLINE_CACHE_NAME);

		async function worker(): Promise<void> {
			while (run.failure === undefined) {
				const article = queue.shift();
				if (article === undefined) {
					if (!run.walking) return;
					await new Promise<void>((resume) => waiting.push(resume));
					continue;
				}
				try {
					const kept = await keepArticle(cache, article);
					if (page.leaving) return;
					if (kept) {
						run.kept += 1;
						tagKeptArticle(article);
					} else {
						run.notReady += 1;
					}
				} catch (error) {
					run.failure = error;
					wake();
					return;
				}
				state.done += 1;
				record();
				progressed();
			}
		}

		const walk = walkListing({
			cache,
			listing,
			found: (article) => {
				const key = offlineCacheKey(article);
				if (seen.has(key)) return;
				seen.add(key);
				queue.push(article);
				if (headerTotal !== undefined) state.total = Math.max(headerTotal, seen.size);
				wake();
			},
			stopped: () => run.failure !== undefined,
		})
			.catch((error: unknown) => {
				run.failure = error;
			})
			.finally(() => {
				run.walking = false;
				if (run.failure === undefined) state.total = seen.size;
				progressed();
				wake();
			});

		await Promise.all([walk, ...Array.from({ length: ARTICLES_IN_FLIGHT }, worker)]);

		if (run.failure instanceof SignedOut) return signedOutStatus(run.kept);
		if (run.failure !== undefined || page.leaving) return LISTING_UNAVAILABLE;
		deps.runRecord.clear();
		return finishedStatus({ total: seen.size, notReady: run.notReady });
	}

	function start(listingHref: string): void {
		const total = knownTabTotal(deps.document);
		Object.assign(state, {
			running: true,
			started: true,
			done: 0,
			total,
			status: total === undefined ? PREPARING : `Downloading 0 of ${count(total)}`,
		});
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

	function retag(): void {
		tagCards().catch(() => undefined);
	}

	deps.addPageHideListener(() => {
		page.leaving = true;
	});
	deps.addSettleListener(() => {
		paint();
		retag();
	});
	showUnfinishedRun();
	paint();
	retag();
}
