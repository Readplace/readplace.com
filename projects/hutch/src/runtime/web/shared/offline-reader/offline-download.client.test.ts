import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { JSDOM } from "jsdom";
import { destinationUrl } from "../../test-helpers/article-fixtures";
import { renderReaderSlot } from "../article-body/reader-slot/reader-slot.component";
import { renderSummarySlot } from "../article-body/summary-slot/summary-slot.component";
import { renderNextRead } from "../next-read/next-read.component";
import { OFFLINE_SAVED_AT_HEADER, OFFLINE_SOURCE_HEADER, stampOfflineCopy as contractStamp } from "./offline-cache";
import {
	type DownloadRequest,
	type DownloadResponse,
	type OfflineDownloadDeps,
	initOfflineDownload,
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

interface ResponseSpec {
	status?: number;
	redirected?: boolean;
	body?: string;
}

interface StoredEntry {
	source: string;
	savedAt?: string;
	body?: string;
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
		renderSummarySlot({ crawl: { status: "ready" }, content, summary: { status: "ready", summary: "Key points." } }) +
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
}) {
	const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${options.body ?? controlMarkup()}</main></body></html>`, {
		url: `${ORIGIN}/queue?utm_source=header-nav&utm_medium=internal&utm_content=readlist`,
	});
	const document = dom.window.document;
	const sent: Sent[] = [];
	const opened: string[] = [];
	const store = new Map<string, StoredEntry>(Object.entries(options.cached ?? {}));
	const copyOf = new WeakMap<DownloadResponse, StoredEntry>();
	const dated = new WeakSet<DownloadResponse>();
	const consumed = new WeakSet<DownloadResponse>();
	const deleted: string[] = [];
	const settleListeners: Array<() => void> = [];

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

	function fetched(input: { url: string; spec: ResponseSpec }): DownloadResponse {
		return fakeResponse({ entry: { source: input.url, body: input.spec.body }, spec: input.spec, headers: new Map() });
	}

	function storedCopy(entry: StoredEntry): DownloadResponse {
		return fakeResponse({
			entry,
			spec: {},
			headers: new Map([
				[OFFLINE_SOURCE_HEADER.toLowerCase(), entry.source],
				[OFFLINE_SAVED_AT_HEADER.toLowerCase(), entry.savedAt],
			]),
		});
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
							};
						},
					},
			parseHtml: (html) => new dom.window.DOMParser().parseFromString(html, "text/html"),
			addSettleListener: (listener) => {
				settleListeners.push(listener);
			},
			now: () => NOW,
			stampCopy: datedCopy,
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
		stored: () => Object.fromEntries(Array.from(store, ([key, entry]) => [key, entry.source])),
		savedAt: () => Object.fromEntries(Array.from(store, ([key, entry]) => [key, entry.savedAt])),
		sentTo: (init: unknown) => sent.filter((call) => isDeepStrictEqual(call.init, init)).map((call) => call.url),
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

		expect(page.opened).toEqual([CACHE_NAME]);
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

	it("counts an article as not ready, keeping nothing of it, when the server redirects, fails, is still reading or summarising it, or never answers", async () => {
		const cards = [
			"/queue/r1/view?v=a",
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
				[`${ORIGIN}/queue/r1/view?v=a`]: { redirected: true, body: readerPage("<p>Log in</p>") },
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
		expect(page.status()).toBe("1 available offline, 5 not ready");
		expect(page.progress().value).toBe(6);
		expect(page.progress().max).toBe(6);
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
		expect(page.status()).toBe("Downloading 2 of 2");

		second.resolve({ body: readerPage("<p>Two</p>") });
		await flush();

		expect(page.button().disabled).toBe(false);
		expect(page.progress().value).toBe(2);
		expect(page.status()).toBe("2 available offline");
	});

	it("hides the last run's progress while a new run walks the listing again", async () => {
		const listing = deferredRoute();
		const routes: Record<string, Route> = {
			[`${ORIGIN}${TRACKED_LISTING}`]: { body: listingPage({ cards: ["/queue/a1/view?v=one"] }) },
			[`${ORIGIN}/queue/a1/view?v=one`]: { body: readerPage("<p>One</p>") },
		};
		const page = startDownload({ routes });
		page.press();
		await flush();
		expect(page.progress().hidden).toBe(false);

		routes[`${ORIGIN}${TRACKED_LISTING}`] = listing.promise;
		page.press();
		await flush();

		expect(page.progress().hidden).toBe(true);
		expect(page.status()).toBe("");
		listing.resolve({ body: listingPage({ cards: ["/queue/a1/view?v=one"] }) });
		await flush();
		expect(page.status()).toBe("1 available offline");
	});

	it.each<[string, Route]>([
		["fails", { status: 503 }],
		["sends the reader to log in", { redirected: true, body: "<main class=\"login\"></main>" }],
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
		expect(page.status()).toBe("Downloading 1 of 1");
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
