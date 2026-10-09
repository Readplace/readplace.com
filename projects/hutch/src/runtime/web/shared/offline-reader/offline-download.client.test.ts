import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { JSDOM } from "jsdom";
import { destinationUrl } from "../../test-helpers/article-fixtures";
import { renderReaderSlot } from "../article-body/reader-slot/reader-slot.component";
import { renderSummarySlot } from "../article-body/summary-slot/summary-slot.component";
import { renderNextRead } from "../next-read/next-read.component";
import {
	OFFLINE_OWNER_EXPIRES_HEADER,
	OFFLINE_OWNER_HEADER,
	OFFLINE_SAVED_AT_HEADER,
	OFFLINE_SOURCE_HEADER,
	offlineOwnerMarker as contractMarker,
	stampOfflineCopy as contractStamp,
} from "./offline-cache";
import {
	type DownloadRequest,
	type DownloadResponse,
	type OfflineDownloadDeps,
	initOfflineDownload,
	offlineOwnerMarker,
	stampOfflineCopy,
} from "./offline-download.client";

const ORIGIN = "https://readplace.com";
const CACHE_NAME = "readplace-offline-v1";
const TRACKED_LISTING = "/queue?utm_source=queue-listing&utm_medium=internal&utm_content=download-offline";
const CARD_TRACKING = "utm_source=queue-card&utm_medium=internal&utm_content=open-article-title&utm_term=desktop";
const ARTICLE_REQUEST = { credentials: "same-origin", headers: { Purpose: "prefetch", Accept: "text/html" } };
const LISTING_REQUEST = { credentials: "same-origin", headers: { Accept: "text/html" } };
const IMAGE_REQUEST = { mode: "cors", credentials: "omit" };
const ARTICLE_URL = destinationUrl("https://example.com/article");
const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const SAVED_NOW = new Date(NOW).toISOString();
const SAVED_YESTERDAY = new Date(NOW - DAY_MS).toISOString();
const SAVED_29_DAYS_AGO = new Date(NOW - 29 * DAY_MS).toISOString();
const SAVED_31_DAYS_AGO = new Date(NOW - 31 * DAY_MS).toISOString();
const OWNER_KEY = `${ORIGIN}/queue/offline-owner`;
const OWNER = "5e55a0d1";
const OTHER_OWNER = "0th3r5e5";
const SESSION_EXPIRES = String((NOW + DAY_MS) / 1000);

interface ResponseSpec {
	status?: number;
	redirected?: boolean;
	body?: string;
}

interface StoredEntry {
	source: string;
	savedAt?: string;
	body?: string;
	owner?: string;
}

type Route = ResponseSpec | "network-down" | Promise<ResponseSpec>;

interface Sent {
	url: string;
	init: DownloadRequest;
}

function controlMarkup(input: { href?: string; stateClass?: string } = {}): string {
	return `<header class="readlist-listing__header">
		<a class="readlist-listing__sort" href="/queue?order=asc">Newest first</a>
		<div class="readlist-listing__offline ${input.stateClass ?? "readlist-listing__offline--offered"}" data-offline-download="${input.href ?? TRACKED_LISTING}" data-test-offline-download>
			<button type="button" data-offline-download-start data-test-offline-download-start>Download unread for offline</button>
			<progress hidden data-offline-download-progress data-test-offline-download-progress></progress>
			<span aria-live="polite" data-offline-download-status data-test-offline-download-status></span>
		</div>
	</header>`;
}

function tabTotal(total: number): string {
	return `<span class="readlist__count" id="readlist-count"><span class="readlist__count-number"><span class="readlist__count-value readlist__count-value--known">${total}</span></span> <span class="readlist__count-noun">Saved Articles</span></span>`;
}

function cardMarkup(href: string): string {
	return `<article class="readlist-article"><a class="readlist-article__title" href="${href}&${CARD_TRACKING}">Title</a><div class="readlist-article__foot"><div class="readlist-article__meta"><span class="readlist-article__saved">Today</span></div></div></article>`;
}

function listingPage(input: { cards: string[]; next?: string; prev?: string }): string {
	const cards = input.cards
		.map(
			(href) =>
				`<article class="readlist-article"><a class="readlist-article__title" href="${href}&${CARD_TRACKING}">Title</a><a class="readlist-article__excerpt" href="${href}&utm_source=queue-card&utm_content=open-article-excerpt">Excerpt</a></article>`,
		)
		.join("");
	const prev = input.prev ? `<a class="pagination__link" href="${input.prev}" rel="prev">Previous</a>` : "";
	const next = input.next
		? `<a class="pagination__link" href="${input.next}" rel="next">Next</a>`
		: `<span class="pagination__link" aria-disabled="true">Next</span>`;
	return `<!DOCTYPE html><html><body><nav class="pagination"><a href="/queue?page=9" rel="next">Header next</a></nav><main><div class="readlist-list">${cards}</div><nav class="pagination">${prev}${next}</nav></main></body></html>`;
}

function readerPage(bodyHtml: string, outside = ""): string {
	return `<!DOCTYPE html><html><body><main class="reader"><div class="reader__article-body" data-article-body>${bodyHtml}</div>${outside}</main></body></html>`;
}

function finishedArticle(content: string): string {
	return (
		renderSummarySlot({ crawl: { status: "ready" }, content, summary: { status: "ready", summary: "Key points.", topics: [] } }) +
		renderReaderSlot({ crawl: { status: "ready" }, content, url: ARTICLE_URL, appOrigin: ORIGIN })
	);
}

function deferredRoute() {
	const settle: { resolve: (spec: ResponseSpec) => void } = { resolve: () => {} };
	const promise = new Promise<ResponseSpec>((resolve) => {
		settle.resolve = resolve;
	});
	return { promise, resolve: settle.resolve };
}

function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function startDownload(options: {
	routes: Record<string, Route>;
	cached?: Record<string, StoredEntry>;
	withoutCacheApi?: boolean;
	body?: string;
	runRecord?: string | null;
	cacheUnavailable?: boolean;
	confirmedOwner?: string;
}) {
	const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${options.body ?? controlMarkup()}</main></body></html>`, {
		url: `${ORIGIN}/queue?utm_source=header-nav&utm_medium=internal&utm_content=readlist`,
	});
	const document = dom.window.document;
	const sent: Sent[] = [];
	const opened: string[] = [];
	const store = new Map<string, StoredEntry>(
		Object.entries(options.cached ?? {}).map(([key, entry]) => [key, { owner: OWNER, ...entry }]),
	);
	if (options.cached !== undefined) {
		store.set(OWNER_KEY, { source: "owner marker", savedAt: SAVED_YESTERDAY, owner: options.confirmedOwner ?? OWNER });
	}
	const copyOf = new WeakMap<DownloadResponse, StoredEntry>();
	const dated = new WeakSet<DownloadResponse>();
	const consumed = new WeakSet<DownloadResponse>();
	const deleted: string[] = [];
	const settleListeners: Array<() => void> = [];
	const pageHideListeners: Array<() => void> = [];
	const record = { value: options.runRecord ?? null, writes: 0 };

	function fakeResponse(input: {
		entry: StoredEntry;
		spec: ResponseSpec;
		headers: Map<string, string | undefined>;
	}): DownloadResponse {
		const status = input.spec.status ?? 200;
		const response: DownloadResponse = {
			status,
			ok: status >= 200 && status < 300,
			redirected: input.spec.redirected ?? false,
			headers: { get: (name) => input.headers.get(name.toLowerCase()) ?? null },
			async text() {
				assert(!consumed.has(response), `the body of ${input.entry.source} must be read once`);
				consumed.add(response);
				return input.entry.body ?? "";
			},
			clone() {
				assert(!consumed.has(response), `${input.entry.source} must be cloned before its body is read`);
				return fakeResponse(input);
			},
		};
		copyOf.set(response, input.entry);
		return response;
	}

	function ownerHeaders(entry: StoredEntry): Array<[string, string | undefined]> {
		return [
			[OFFLINE_OWNER_HEADER.toLowerCase(), entry.owner],
			[OFFLINE_OWNER_EXPIRES_HEADER.toLowerCase(), entry.owner === undefined ? undefined : SESSION_EXPIRES],
		];
	}

	function fetched(input: { url: string; spec: ResponseSpec }): DownloadResponse {
		const entry = { source: input.url, body: input.spec.body, owner: input.spec.redirected ? undefined : OWNER };
		return fakeResponse({ entry, spec: input.spec, headers: new Map(ownerHeaders(entry)) });
	}

	function storedCopy(entry: StoredEntry): DownloadResponse {
		return fakeResponse({
			entry,
			spec: {},
			headers: new Map([
				[OFFLINE_SOURCE_HEADER.toLowerCase(), entry.source],
				[OFFLINE_SAVED_AT_HEADER.toLowerCase(), entry.savedAt],
				...ownerHeaders(entry),
			]),
		});
	}

	function markedOwner(answer: DownloadResponse, savedAt: number): DownloadResponse {
		const marker = storedCopy({
			source: "owner marker",
			savedAt: new Date(savedAt).toISOString(),
			owner: String(answer.headers.get(OFFLINE_OWNER_HEADER)),
		});
		dated.add(marker);
		return marker;
	}

	function datedCopy(response: DownloadResponse, savedAt: number): DownloadResponse {
		assert(!consumed.has(response), "a copy must still hold its body when it is dated");
		consumed.add(response);
		const entry = copyOf.get(response);
		assert(entry, "the download dates only a response it fetched or found stored");
		const copy = storedCopy({ ...entry, savedAt: new Date(savedAt).toISOString() });
		dated.add(copy);
		return copy;
	}

	function deps(): OfflineDownloadDeps {
		return {
			document,
			fetchFn: async (url, init) => {
				sent.push({ url, init });
				const route = options.routes[url];
				assert(route !== undefined, `the download must not fetch ${url}`);
				if (route === "network-down") throw new TypeError("Failed to fetch");
				return fetched({ url, spec: await route });
			},
			caches: options.withoutCacheApi
				? undefined
				: {
						async open(name) {
							opened.push(name);
							if (options.cacheUnavailable) throw new DOMException("The operation is insecure.", "SecurityError");
							return {
								async match(key, matchOptions) {
									assert.deepEqual(matchOptions, { ignoreVary: true });
									const entry = store.get(key);
									return entry === undefined ? undefined : storedCopy(entry);
								},
								async put(key, response) {
									assert(dated.has(response), `the copy stored under ${key} must say when it was saved`);
									assert(!consumed.has(response), `the copy stored under ${key} must still hold its body`);
									const entry = copyOf.get(response);
									assert(entry, "only a dated copy is ever stored");
									store.set(key, entry);
								},
								async delete(key) {
									deleted.push(key);
									return store.delete(key);
								},
								async keys() {
									return Array.from(store.keys(), (url) => ({ url }));
								},
							};
						},
					},
			parseHtml: (html) => new dom.window.DOMParser().parseFromString(html, "text/html"),
			addSettleListener: (listener) => {
				settleListeners.push(listener);
			},
			addPageHideListener: (listener) => {
				pageHideListeners.push(listener);
			},
			now: () => NOW,
			stampCopy: datedCopy,
			markOwner: markedOwner,
			runRecord: {
				read: () => record.value,
				write: (value) => {
					record.value = value;
					record.writes += 1;
				},
				clear: () => {
					record.value = null;
				},
			},
		};
	}

	initOfflineDownload(deps());

	function control(): HTMLElement {
		const element = document.querySelector<HTMLElement>("[data-test-offline-download]");
		assert(element, "the offline download control must be on the page");
		return element;
	}

	function button(): HTMLButtonElement {
		const element = control().querySelector<HTMLButtonElement>("[data-test-offline-download-start]");
		assert(element, "the control must hold its start button");
		return element;
	}

	function progress(): HTMLProgressElement {
		const element = control().querySelector<HTMLProgressElement>("[data-test-offline-download-progress]");
		assert(element, "the control must hold its progress bar");
		return element;
	}

	function status(): string | null {
		const element = control().querySelector("[data-test-offline-download-status]");
		assert(element, "the control must hold its status line");
		return element.textContent;
	}

	function press(target: Element = button()): void {
		target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	}

	function storedCopies(): Array<[string, StoredEntry]> {
		return Array.from(store).filter(([key]) => key !== OWNER_KEY);
	}

	return {
		dom,
		document,
		sent,
		opened,
		deps,
		control,
		button,
		progress,
		status,
		press,
		revealed: () => document.documentElement.hasAttribute("data-offline-download-ready"),
		deleted,
		record,
		offlineTags: () =>
			Array.from(document.querySelectorAll("[data-offline-tag]"), (tag) =>
				tag.closest(".readlist-article")?.querySelector(".readlist-article__title")?.getAttribute("href"),
			),
		stored: () => Object.fromEntries(storedCopies().map(([key, entry]) => [key, entry.source])),
		savedAt: () => Object.fromEntries(storedCopies().map(([key, entry]) => [key, entry.savedAt])),
		confirmedOwner: () => store.get(OWNER_KEY)?.owner,
		sentTo: (init: unknown) => sent.filter((call) => isDeepStrictEqual(call.init, init)).map((call) => call.url),
		leave: () => {
			for (const listener of pageHideListeners) listener();
		},
		settle: () => {
			for (const listener of settleListeners) listener();
		},
	};
}

describe("initOfflineDownload", () => {
	it("keeps the control hidden in a browser that offers no Cache API", () => {
		const page = startDownload({ routes: {}, withoutCacheApi: true });

		expect(page.revealed()).toBe(false);
	});

	it("reveals the control where the Cache API exists, ready to press with no progress yet", () => {
		const page = startDownload({ routes: {} });

		expect(page.revealed()).toBe(true);
		expect(page.button().disabled).toBe(false);
		expect(page.progress().hidden).toBe(true);
		expect(page.status()).toBe("");
	});

	it("walks every listing page through its next link and keeps each page under its listing key", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: [], next: "/queue?page=2&utm_source=queue-pagination&utm_medium=internal&utm_content=next" }),
				},
				[`${ORIGIN}/queue?page=2`]: {
					body: listingPage({
						cards: [],
						prev: "/queue?utm_source=queue-pagination&utm_medium=internal&utm_content=prev",
						next: "/queue?page=3&utm_source=queue-pagination&utm_medium=internal&utm_content=next",
					}),
				},
				[`${ORIGIN}/queue?page=3`]: { body: listingPage({ cards: [] }) },
			},
		});

		page.press();
		await flush();

		expect(new Set(page.opened)).toEqual(new Set([CACHE_NAME]));
		expect(page.sentTo(LISTING_REQUEST)).toEqual([
			`${ORIGIN}${TRACKED_LISTING}`,
			`${ORIGIN}/queue?page=2`,
			`${ORIGIN}/queue?page=3`,
		]);
		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue?page=2`]: `${ORIGIN}/queue?page=2`,
			[`${ORIGIN}/queue?page=3`]: `${ORIGIN}/queue?page=3`,
		});
		expect(page.status()).toBe("0 available offline");
	});

	it("downloads every unread article once, untracked, as a prefetch of its HTML page", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({
						cards: ["/queue/a1/view?queue=work&v=one", "/queue/b2/view?queue=work&v=two"],
						next: "/queue?queue=work&page=2&utm_source=queue-pagination",
					}),
				},
				[`${ORIGIN}/queue?queue=work&page=2`]: {
					body: listingPage({ cards: ["/queue/b2/view?queue=work&v=two", "/queue/c3/view?queue=work&v=three"] }),
				},
				[`${ORIGIN}/queue/a1/view?queue=work&v=one`]: { body: readerPage("<p>One</p>") },
				[`${ORIGIN}/queue/b2/view?queue=work&v=two`]: { body: readerPage("<p>Two</p>") },
				[`${ORIGIN}/queue/c3/view?queue=work&v=three`]: { body: readerPage("<p>Three</p>") },
			},
		});

		page.press();
		await flush();

		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([
			`${ORIGIN}/queue/a1/view?queue=work&v=one`,
			`${ORIGIN}/queue/b2/view?queue=work&v=two`,
			`${ORIGIN}/queue/c3/view?queue=work&v=three`,
		]);
		expect(page.stored()).toMatchObject({
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?queue=work&v=one`,
			[`${ORIGIN}/queue/b2/view`]: `${ORIGIN}/queue/b2/view?queue=work&v=two`,
			[`${ORIGIN}/queue/c3/view`]: `${ORIGIN}/queue/c3/view?queue=work&v=three`,
		});
		expect(page.status()).toBe("3 available offline");
	});

	it("keeps every image the article body shows, from its src and each srcset candidate, fetched without credentials", async () => {
		const body = [
			`<img src="https://cdn.readplace.com/a.png" srcset="https://cdn.readplace.com/a-1x.png 1x, https://cdn.readplace.com/a-2x.png 2x">`,
			`<img src="https://cdn.readplace.com/a.png" alt="the same picture again">`,
			`<img srcset="https://img.example.com/w_640,h_480/b.jpg 640w,https://img.example.com/c.jpg, , https://img.example.com/d.jpg">`,
			`<picture><source srcset="https://cdn.readplace.com/e.webp" type="image/webp"><img src="media/f.png"></picture>`,
		].join("");
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: {
					body: readerPage(body, `<img src="https://cdn.readplace.com/outside-the-body.png">`),
				},
				"https://cdn.readplace.com/a.png": {},
				"https://cdn.readplace.com/a-1x.png": {},
				"https://cdn.readplace.com/a-2x.png": {},
				"https://img.example.com/w_640,h_480/b.jpg": {},
				"https://img.example.com/c.jpg": {},
				"https://img.example.com/d.jpg": {},
				"https://cdn.readplace.com/e.webp": {},
				[`${ORIGIN}/queue/a1/media/f.png`]: {},
			},
		});

		page.press();
		await flush();

		const images = [
			"https://cdn.readplace.com/a.png",
			"https://cdn.readplace.com/a-1x.png",
			"https://cdn.readplace.com/a-2x.png",
			"https://img.example.com/w_640,h_480/b.jpg",
			"https://img.example.com/c.jpg",
			"https://img.example.com/d.jpg",
			"https://cdn.readplace.com/e.webp",
			`${ORIGIN}/queue/a1/media/f.png`,
		];
		expect(page.sentTo(IMAGE_REQUEST)).toEqual(images);
		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?v=one`,
			...Object.fromEntries(images.map((image) => [image, image])),
		});
	});

	it("still keeps an article whose images fail, storing only the images that loaded", async () => {
		const body = [
			`<img src="https://cdn.readplace.com/missing.png">`,
			`<img src="https://third-party.example/no-cors.png">`,
			`<img src="http://[not-a-url">`,
			`<img src="https://cdn.readplace.com/kept.png">`,
		].join("");
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage(body) },
				"https://cdn.readplace.com/missing.png": { status: 404 },
				"https://third-party.example/no-cors.png": "network-down",
				"https://cdn.readplace.com/kept.png": {},
			},
		});

		page.press();
		await flush();

		expect(page.sentTo(IMAGE_REQUEST)).toEqual([
			"https://cdn.readplace.com/missing.png",
			"https://third-party.example/no-cors.png",
			"https://cdn.readplace.com/kept.png",
		]);
		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?v=one`,
			"https://cdn.readplace.com/kept.png": "https://cdn.readplace.com/kept.png",
		});
		expect(page.status()).toBe("1 available offline");
	});

	it("counts an article as not ready, keeping nothing of it, when the server fails, is still reading or summarising it, or never answers", async () => {
		const cards = [
			"/queue/f2/view?v=b",
			"/queue/u3/view?v=c",
			"/queue/s4/view?v=d",
			"/queue/n5/view?v=e",
			"/queue/k6/view?v=f",
		];
		const stillReading =
			renderSummarySlot({ crawl: { status: "pending" }, summary: undefined, summaryPollUrl: "/queue/u3/summary?poll=1" }) +
			renderReaderSlot({ crawl: { status: "pending" }, url: ARTICLE_URL, readerPollUrl: "/queue/u3/reader?poll=1", appOrigin: ORIGIN });
		const stillSummarising =
			renderSummarySlot({
				crawl: { status: "ready" },
				content: "<p>Read</p>",
				summary: { status: "pending" },
				summaryPollUrl: "/queue/s4/summary?poll=1",
			}) + renderReaderSlot({ crawl: { status: "ready" }, content: "<p>Read</p>", url: ARTICLE_URL, appOrigin: ORIGIN });
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards }) },
				[`${ORIGIN}/queue/f2/view?v=b`]: { status: 500 },
				[`${ORIGIN}/queue/u3/view?v=c`]: { body: readerPage(stillReading) },
				[`${ORIGIN}/queue/s4/view?v=d`]: { body: readerPage(stillSummarising) },
				[`${ORIGIN}/queue/n5/view?v=e`]: "network-down",
				[`${ORIGIN}/queue/k6/view?v=f`]: { body: readerPage(finishedArticle("<p>Ready</p>")) },
			},
		});

		page.press();
		await flush();

		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/k6/view`]: `${ORIGIN}/queue/k6/view?v=f`,
		});
		expect(page.status()).toBe("1 available offline, 4 not ready");
		expect(page.progress().value).toBe(5);
		expect(page.progress().max).toBe(5);
	});

	it("keeps an article whose text and summary are done while its Next-read slot still loads, as an imported article's always does", async () => {
		const stillLoadingNextRead = renderNextRead({
			returnTo: "/queue/a1/view",
			readerPathFor: (articleId) => `/queue/${articleId}/view`,
			pollUrl: "/queue/a1/related?poll=1",
		});
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: {
					body: readerPage(
						finishedArticle(`<p>Imported</p><img src="https://cdn.readplace.com/imported.png">`),
						stillLoadingNextRead,
					),
				},
				"https://cdn.readplace.com/imported.png": {},
			},
		});

		page.press();
		await flush();

		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?v=one`,
			"https://cdn.readplace.com/imported.png": "https://cdn.readplace.com/imported.png",
		});
		expect(page.status()).toBe("1 available offline");
	});

	it("skips an article whose stored copy is already its current version, wherever that copy came from, fetching only the images that copy still lacks", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one", "/queue/b2/view?v=two"] }),
				},
				"https://cdn.readplace.com/below-the-fold.png": {},
			},
			cached: {
				[`${ORIGIN}/queue/a1/view`]: {
					source: `${ORIGIN}/queue/a1/view?v=one`,
					savedAt: SAVED_YESTERDAY,
					body: readerPage(
						`<img src="https://cdn.readplace.com/seen.png"><img loading="lazy" src="https://cdn.readplace.com/below-the-fold.png">`,
					),
				},
				[`${ORIGIN}/queue/b2/view`]: {
					source: `${ORIGIN}/queue/b2/view?v=two&${CARD_TRACKING}`,
					savedAt: SAVED_YESTERDAY,
					body: readerPage(`<img src="https://cdn.readplace.com/seen.png">`),
				},
				"https://cdn.readplace.com/seen.png": { source: "https://cdn.readplace.com/seen.png", savedAt: SAVED_YESTERDAY },
			},
		});

		page.press();
		await flush();

		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([]);
		expect(page.sentTo(IMAGE_REQUEST)).toEqual(["https://cdn.readplace.com/below-the-fold.png"]);
		expect(page.stored()["https://cdn.readplace.com/below-the-fold.png"]).toBe(
			"https://cdn.readplace.com/below-the-fold.png",
		);
		expect(page.status()).toBe("2 available offline");
	});

	it("downloads again an article whose content changed since its copy was stored", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=edited"] }) },
				[`${ORIGIN}/queue/a1/view?v=edited`]: { body: readerPage("<p>Edited</p>") },
			},
			cached: {
				[`${ORIGIN}/queue/a1/view`]: { source: `${ORIGIN}/queue/a1/view?v=original`, savedAt: SAVED_YESTERDAY },
			},
		});

		page.press();
		await flush();

		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([`${ORIGIN}/queue/a1/view?v=edited`]);
		expect(page.stored()[`${ORIGIN}/queue/a1/view`]).toBe(`${ORIGIN}/queue/a1/view?v=edited`);
	});

	it("dates every listing page, article and image it keeps with the time it saved it", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage(`<img src="https://cdn.readplace.com/a.png">`) },
				"https://cdn.readplace.com/a.png": {},
			},
		});

		page.press();
		await flush();

		expect(page.savedAt()).toEqual({
			[`${ORIGIN}/queue`]: SAVED_NOW,
			[`${ORIGIN}/queue/a1/view`]: SAVED_NOW,
			"https://cdn.readplace.com/a.png": SAVED_NOW,
		});
	});

	it("refreshes the saved time of a current copy it does not download again, and of each image it already holds", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
			},
			cached: {
				[`${ORIGIN}/queue/a1/view`]: {
					source: `${ORIGIN}/queue/a1/view?v=one`,
					savedAt: SAVED_29_DAYS_AGO,
					body: readerPage(`<img src="https://cdn.readplace.com/held.png">`),
				},
				"https://cdn.readplace.com/held.png": {
					source: "https://cdn.readplace.com/held.png",
					savedAt: SAVED_29_DAYS_AGO,
				},
			},
		});

		page.press();
		await flush();

		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([]);
		expect(page.sentTo(IMAGE_REQUEST)).toEqual([]);
		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?v=one`,
			"https://cdn.readplace.com/held.png": "https://cdn.readplace.com/held.png",
		});
		expect(page.savedAt()).toEqual({
			[`${ORIGIN}/queue`]: SAVED_NOW,
			[`${ORIGIN}/queue/a1/view`]: SAVED_NOW,
			"https://cdn.readplace.com/held.png": SAVED_NOW,
		});
		expect(page.status()).toBe("1 available offline");
	});

	it("deletes a copy saved more than 30 days ago and downloads the article and its images again", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage(`<img src="https://cdn.readplace.com/a.png">`) },
				"https://cdn.readplace.com/a.png": {},
			},
			cached: {
				[`${ORIGIN}/queue/a1/view`]: {
					source: `${ORIGIN}/queue/a1/view?v=one`,
					savedAt: SAVED_31_DAYS_AGO,
					body: readerPage(`<img src="https://cdn.readplace.com/a.png">`),
				},
				"https://cdn.readplace.com/a.png": { source: "https://cdn.readplace.com/a.png", savedAt: SAVED_31_DAYS_AGO },
			},
		});

		page.press();
		await flush();

		expect(page.deleted).toEqual([`${ORIGIN}/queue/a1/view`, "https://cdn.readplace.com/a.png"]);
		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([`${ORIGIN}/queue/a1/view?v=one`]);
		expect(page.sentTo(IMAGE_REQUEST)).toEqual(["https://cdn.readplace.com/a.png"]);
		expect(page.savedAt()).toEqual({
			[`${ORIGIN}/queue`]: SAVED_NOW,
			[`${ORIGIN}/queue/a1/view`]: SAVED_NOW,
			"https://cdn.readplace.com/a.png": SAVED_NOW,
		});
	});

	it("deletes a copy saved more than 30 days ago even when the article cannot be downloaded again", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { status: 500 },
			},
			cached: {
				[`${ORIGIN}/queue/a1/view`]: {
					source: `${ORIGIN}/queue/a1/view?v=one`,
					savedAt: SAVED_31_DAYS_AGO,
					body: readerPage("<p>One</p>"),
				},
			},
		});

		page.press();
		await flush();

		expect(page.deleted).toEqual([`${ORIGIN}/queue/a1/view`]);
		expect(page.stored()).toEqual({ [`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}` });
		expect(page.status()).toBe("0 available offline, 1 not ready");
	});

	it("hands its bundle the contract's stamp, so the download dates its copies the way the worker does", () => {
		expect(stampOfflineCopy).toBe(contractStamp);
	});

	it("hands its bundle the contract's owner marker, so the download records a session the way the worker does", () => {
		expect(offlineOwnerMarker).toBe(contractMarker);
	});

	it("records the session the listing answered for, the only one the worker will serve the copies to offline", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
			},
		});

		page.press();
		await flush();

		expect(page.confirmedOwner()).toBe(OWNER);
		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?v=one`,
		});
	});

	it("forgets every copy another session stored before keeping this session's", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
			},
			cached: {
				[`${ORIGIN}/queue/z9/view`]: { source: `${ORIGIN}/queue/z9/view?v=theirs`, savedAt: SAVED_YESTERDAY, owner: OTHER_OWNER },
				[`${ORIGIN}/queue/a1/view`]: { source: `${ORIGIN}/queue/a1/view?v=one`, savedAt: SAVED_YESTERDAY, owner: OTHER_OWNER },
			},
			confirmedOwner: OTHER_OWNER,
		});

		page.press();
		await flush();

		expect(page.confirmedOwner()).toBe(OWNER);
		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([`${ORIGIN}/queue/a1/view?v=one`]);
		expect(page.stored()).toEqual({
			[`${ORIGIN}/queue`]: `${ORIGIN}${TRACKED_LISTING}`,
			[`${ORIGIN}/queue/a1/view`]: `${ORIGIN}/queue/a1/view?v=one`,
		});
	});

	it("shows how far the download has got and holds the button until it finishes", async () => {
		const second = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one", "/queue/b2/view?v=two"] }),
				},
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
				[`${ORIGIN}/queue/b2/view?v=two`]: second.promise,
			},
		});

		page.press();
		await flush();

		expect(page.button().disabled).toBe(true);
		expect(page.progress().hidden).toBe(false);
		expect(page.progress().max).toBe(2);
		expect(page.progress().value).toBe(1);
		expect(page.status()).toBe("Downloading 1 of 2");

		second.resolve({ body: readerPage("<p>Two</p>") });
		await flush();

		expect(page.button().disabled).toBe(false);
		expect(page.progress().value).toBe(2);
		expect(page.status()).toBe("2 available offline");
	});

	it("shows the progress bar and 0 of the tab's total the moment the button is pressed, before any listing page answers", () => {
		const listing = deferredRoute();
		const page = startDownload({
			routes: { [`${ORIGIN}${TRACKED_LISTING}`]: listing.promise },
			body: tabTotal(1296) + controlMarkup(),
		});

		page.press();

		expect(page.button().disabled).toBe(true);
		expect(page.progress().hidden).toBe(false);
		expect(page.progress().max).toBe(1296);
		expect(page.progress().value).toBe(0);
		expect(page.status()).toBe("Downloading 0 of 1,296");
	});

	it("shows a sweeping progress bar while preparing when the tab's total has not arrived, then counts once the listing is walked", async () => {
		const article = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one", "/queue/b2/view?v=two"] }),
				},
				[`${ORIGIN}/queue/a1/view?v=one`]: article.promise,
				[`${ORIGIN}/queue/b2/view?v=two`]: article.promise,
			},
		});

		page.press();

		expect(page.progress().hidden).toBe(false);
		expect(page.progress().hasAttribute("value")).toBe(false);
		expect(page.status()).toBe("Preparing download…");
		await flush();
		expect(page.status()).toBe("Downloading 0 of 2");
		expect(page.progress().max).toBe(2);
		article.resolve({ body: readerPage("<p>Either</p>") });
		await flush();
		expect(page.status()).toBe("2 available offline");
	});

	it("raises the total past the tab's count when the listing holds more unread articles than it said", async () => {
		const article = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one", "/queue/b2/view?v=two"] }),
					},
				[`${ORIGIN}/queue/a1/view?v=one`]: article.promise,
				[`${ORIGIN}/queue/b2/view?v=two`]: article.promise,
			},
			body: tabTotal(1) + controlMarkup(),
		});

		page.press();
		await flush();

		expect(page.status()).toBe("Downloading 0 of 2");
		expect(page.progress().max).toBe(2);
	});

	it("downloads six articles at a time, starting the next as each one finishes", async () => {
		const cards = Array.from({ length: 8 }, (_, index) => `/queue/a${index}/view?v=${index}`);
		const answers = cards.map(() => deferredRoute());
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards }) },
				...Object.fromEntries(cards.map((card, index) => [`${ORIGIN}${card}`, answers[index].promise])),
			},
		});

		page.press();
		await flush();
		expect(page.sentTo(ARTICLE_REQUEST)).toEqual(cards.slice(0, 6).map((card) => `${ORIGIN}${card}`));

		answers[3].resolve({ body: readerPage("<p>Four</p>") });
		await flush();
		expect(page.sentTo(ARTICLE_REQUEST)).toHaveLength(7);
		expect(page.status()).toBe("Downloading 1 of 8");

		for (const answer of answers) answer.resolve({ body: readerPage("<p>Any</p>") });
		await flush();
		expect(page.sentTo(ARTICLE_REQUEST)).toHaveLength(8);
		expect(page.status()).toBe("8 available offline");
	});

	it("starts downloading the first page's articles while the next listing page is still loading", async () => {
		const secondPage = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one"], next: "/queue?page=2" }),
				},
				[`${ORIGIN}/queue?page=2`]: secondPage.promise,
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
				[`${ORIGIN}/queue/b2/view?v=two`]: { body: readerPage("<p>Two</p>") },
			},
		});

		page.press();
		await flush();
		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([`${ORIGIN}/queue/a1/view?v=one`]);

		secondPage.resolve({ body: listingPage({ cards: ["/queue/b2/view?v=two"] }) });
		await flush();
		expect(page.sentTo(ARTICLE_REQUEST)).toEqual([
			`${ORIGIN}/queue/a1/view?v=one`,
			`${ORIGIN}/queue/b2/view?v=two`,
		]);
		expect(page.status()).toBe("2 available offline");
	});

	it("says the reader was signed out when the listing sends them to log in", async () => {
		const page = startDownload({
			routes: { [`${ORIGIN}${TRACKED_LISTING}`]: { redirected: true, body: '<main class="login"></main>' } },
		});

		page.press();
		await flush();

		expect(page.stored()).toEqual({});
		expect(page.status()).toBe("You were signed out. Sign in and press again to continue.");
		expect(page.button().disabled).toBe(false);
	});

	it("stops the whole run, instead of carrying on as a guest, once an article answers with a redirect, and says how far it got", async () => {
		const cards = Array.from({ length: 9 }, (_, index) => `/queue/a${index}/view?v=${index}`);
		const lost = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: cards.slice(0, 8), next: "/queue?page=2" }) },
				[`${ORIGIN}/queue?page=2`]: lost.promise,
				[`${ORIGIN}${cards[0]}`]: { body: readerPage("<p>Kept</p>") },
				...Object.fromEntries(
					cards.slice(1).map((card) => [`${ORIGIN}${card}`, { redirected: true, body: readerPage("<p>Public view</p>") }]),
				),
			},
			body: tabTotal(9) + controlMarkup(),
		});

		page.press();
		await flush();
		lost.resolve({ body: listingPage({ cards: cards.slice(8) }) });
		await flush();

		expect(page.sentTo(ARTICLE_REQUEST)).toEqual(cards.slice(0, 6).map((card) => `${ORIGIN}${card}`));
		expect(page.sentTo(LISTING_REQUEST)).toEqual([`${ORIGIN}${TRACKED_LISTING}`, `${ORIGIN}/queue?page=2`]);
		expect(page.status()).toBe("You were signed out. Sign in and press again to continue from 1.");
		expect(JSON.parse(String(page.record.value))).toEqual({ listing: `${ORIGIN}/queue`, kept: 1, total: 9 });
		expect(page.button().disabled).toBe(false);
	});

	it("keeps a record of how far the run got after each article and drops it once the run finishes", async () => {
		const article = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one", "/queue/b2/view?v=two"] }),
				},
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
				[`${ORIGIN}/queue/b2/view?v=two`]: article.promise,
			},
			body: tabTotal(2) + controlMarkup(),
		});

		page.press();
		await flush();
		expect(JSON.parse(String(page.record.value))).toEqual({ listing: `${ORIGIN}/queue`, kept: 1, total: 2 });

		article.resolve({ status: 500 });
		await flush();
		expect(page.record.writes).toBe(2);
		expect(page.record.value).toBeNull();
	});

	it("keeps the record of a run whose listing stops answering part-way, so the next visit offers to continue", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"], next: "/queue?page=2" }) },
				[`${ORIGIN}/queue?page=2`]: { status: 502 },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
			},
			body: tabTotal(40) + controlMarkup(),
		});

		page.press();
		await flush();

		expect(page.status()).toBe("Couldn't load your unread articles");
		expect(JSON.parse(String(page.record.value))).toEqual({ listing: `${ORIGIN}/queue`, kept: 1, total: 40 });
	});

	it("keeps the record of how far it got when the reader leaves the page and the browser aborts the downloads still in flight", async () => {
		const held = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: {
					body: listingPage({ cards: ["/queue/a1/view?v=one", "/queue/b2/view?v=two"] }),
				},
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
				[`${ORIGIN}/queue/b2/view?v=two`]: held.promise,
			},
			body: tabTotal(2) + controlMarkup(),
		});
		page.press();
		await flush();

		page.leave();
		held.resolve({ status: 0 });
		await flush();

		expect(JSON.parse(String(page.record.value))).toEqual({ listing: `${ORIGIN}/queue`, kept: 1, total: 2 });
		expect(page.record.writes).toBe(1);
	});

	it("shows an unfinished run of this listing on load, so the reader knows pressing again continues from there", () => {
		const page = startDownload({
			routes: {},
			runRecord: JSON.stringify({ listing: `${ORIGIN}/queue`, kept: 312, total: 1296 }),
		});

		expect(page.progress().hidden).toBe(false);
		expect(page.progress().value).toBe(312);
		expect(page.progress().max).toBe(1296);
		expect(page.status()).toBe("312 of 1,296 downloaded. Press to continue.");
		expect(page.button().disabled).toBe(false);
	});

	it.each([
		["another listing's run", JSON.stringify({ listing: `${ORIGIN}/queue?queue=work`, kept: 3, total: 9 })],
		["a record it cannot read", "{not json"],
		["a record missing its counts", JSON.stringify({ listing: `${ORIGIN}/queue` })],
	])("shows nothing on load for %s", (_case, runRecord) => {
		const page = startDownload({ routes: {}, runRecord });

		expect(page.progress().hidden).toBe(true);
		expect(page.status()).toBe("");
	});

	it("says the unread articles couldn't load when the browser refuses to open its offline storage", async () => {
		const page = startDownload({ routes: {}, cacheUnavailable: true });

		page.press();
		await flush();

		expect(page.sent).toEqual([]);
		expect(page.status()).toBe("Couldn't load your unread articles");
		expect(page.button().disabled).toBe(false);
	});

	it("tags each card on the page whose stored copy is fresh and still its current version, and no other", async () => {
		const page = startDownload({
			routes: {},
			body:
				controlMarkup() +
				cardMarkup("/queue/a1/view?v=one") +
				cardMarkup("/queue/b2/view?v=recrawled") +
				cardMarkup("/queue/c3/view?v=three") +
				cardMarkup("/queue/d4/view?v=four"),
			cached: {
				[`${ORIGIN}/queue/a1/view`]: { source: `${ORIGIN}/queue/a1/view?v=one&${CARD_TRACKING}`, savedAt: SAVED_YESTERDAY },
				[`${ORIGIN}/queue/b2/view`]: { source: `${ORIGIN}/queue/b2/view?v=original`, savedAt: SAVED_YESTERDAY },
				[`${ORIGIN}/queue/c3/view`]: { source: `${ORIGIN}/queue/c3/view?v=three`, savedAt: SAVED_31_DAYS_AGO },
			},
		});

		await flush();

		expect(page.offlineTags()).toEqual([`/queue/a1/view?v=one&${CARD_TRACKING}`]);
		const tag = page.document.querySelector("[data-offline-tag]");
		expect(tag?.textContent).toBe("Saved offline");
		expect(tag?.classList.contains("chip--success")).toBe(true);
		expect(tag?.querySelector("svg path")?.getAttribute("d")).toBe("M5 14L8.5 17.5L19 6.5");
		expect(page.deleted).toEqual([]);
	});

	it("tags a card as soon as its article is downloaded, and keeps one tag through later settles", async () => {
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
			},
			body: controlMarkup() + cardMarkup("/queue/a1/view?v=one") + cardMarkup("/queue/b2/view?v=two"),
		});
		await flush();
		expect(page.offlineTags()).toEqual([]);

		page.press();
		await flush();
		page.settle();
		await flush();

		expect(page.offlineTags()).toEqual([`/queue/a1/view?v=one&${CARD_TRACKING}`]);
	});

	it("drops a card's tag after a swap brings it back with a newer crawl than the stored copy", async () => {
		const page = startDownload({
			routes: {},
			body: controlMarkup() + cardMarkup("/queue/a1/view?v=one"),
			cached: {
				[`${ORIGIN}/queue/a1/view`]: { source: `${ORIGIN}/queue/a1/view?v=one`, savedAt: SAVED_YESTERDAY },
			},
		});
		await flush();
		expect(page.offlineTags()).toHaveLength(1);

		const title = page.document.querySelector(".readlist-article__title");
		assert(title, "the card must be on the page");
		title.setAttribute("href", `/queue/a1/view?v=recrawled&${CARD_TRACKING}`);
		page.settle();
		await flush();

		expect(page.offlineTags()).toEqual([]);
	});

	it.each<[string, Route]>([
		["fails", { status: 503 }],
		["never answers", "network-down"],
	])("says the unread articles couldn't load and frees the button when the listing %s", async (_case, listing) => {
		const page = startDownload({ routes: { [`${ORIGIN}${TRACKED_LISTING}`]: listing } });

		page.press();
		await flush();

		expect(page.sent).toHaveLength(1);
		expect(page.stored()).toEqual({});
		expect(page.status()).toBe("Couldn't load your unread articles");
		expect(page.button().disabled).toBe(false);
	});

	it("carries a running download onto the control a boosted navigation swaps in, ignoring a press on it meanwhile", async () => {
		const article = deferredRoute();
		const page = startDownload({
			routes: {
				[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
				[`${ORIGIN}/queue/a1/view?v=one`]: article.promise,
			},
		});
		page.press();
		await flush();

		const main = page.document.querySelector("main");
		assert(main, "the page must keep its main");
		main.innerHTML = controlMarkup({ href: "/queue?page=2" });
		page.press();
		await flush();
		expect(page.sentTo(LISTING_REQUEST)).toEqual([`${ORIGIN}${TRACKED_LISTING}`]);
		page.settle();

		expect(page.button().disabled).toBe(true);
		expect(page.status()).toBe("Downloading 0 of 1");
		article.resolve({ body: readerPage("<p>One</p>") });
		await flush();
		expect(page.status()).toBe("1 available offline");
		expect(page.button().disabled).toBe(false);
	});

	it("binds once however many times the page runs the script", async () => {
		const page = startDownload({
			routes: { [`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: [] }) } },
		});
		initOfflineDownload(page.deps());

		page.press();
		await flush();

		expect(page.sentTo(LISTING_REQUEST)).toEqual([`${ORIGIN}${TRACKED_LISTING}`]);
	});

	it("leaves a press anywhere else on the page alone", async () => {
		const page = startDownload({ routes: {} });
		const status = page.document.querySelector("[data-test-offline-download-status]");
		assert(status, "the status line must be on the page");

		page.press(status);
		page.document.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
		await flush();

		expect(page.sent).toEqual([]);
		expect(page.button().disabled).toBe(false);
	});
});
