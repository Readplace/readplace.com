import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import {
	renderReadlistCard,
	toReadlistCardDisplayModel,
} from "../../pages/readlist/readlist-card/readlist-card.component";
import type { ReadlistArticleViewModel } from "../../pages/readlist/readlist.viewmodel";
import { renderReaderSkeleton } from "../../pages/readlist/reader-skeleton/reader-skeleton.component";
import { type HtmxHistoryEventName, initReaderOpen, type ReaderOpenDeps } from "./reader-open.client";

const INJECTED_PAINT_DELAY_MS = 275;

const READER_HREF = "/queue/abc123/view?v=token";
const QUEUE_HREF = "https://readplace.test/queue";
const BANNER_SELECTOR = "#extension-suggestion-banner";

function realCard(overrides?: Partial<ReadlistArticleViewModel>): string {
	const vm: ReadlistArticleViewModel = {
		id: "abc123",
		title: "Article Title",
		siteName: "example.com",
		excerpt: "An excerpt.",
		excerptSource: "generated",
		topics: [],
		url: "https://example.com/post",
		status: "unread",
		readTime: { value: "3", label: "3 min read" },
		saved: { iso: "2025-06-01T12:50:00.000Z", label: "10m ago", mode: "relative" },
		actions: [],
		readerHref: READER_HREF,
		isStalePending: false,
		...overrides,
	};
	return renderReadlistCard(toReadlistCardDisplayModel(vm, { isFirst: false, deviceClass: "desktop" }));
}

const TITLE_ONLY_CARD = `<div class="readlist-article"><a data-test-article-title data-opens-reader data-reader-field="title" href="${READER_HREF}">Only Title</a></div>`;

function shellBanner(show: "true" | "false"): string {
	return `<div class="banner-area"><div id="extension-suggestion-banner" class="extension-suggestion-banner" data-show-extension-suggestion="${show}"></div></div>`;
}

function readerResponse(bodyClass: string, options?: { banner?: string }): string {
	return `<!DOCTYPE html><html><head><title>Article Title — Readplace Reader</title></head><body class="${bodyClass}">${options?.banner ?? ""}<main class="reader" hx-history="false"></main></body></html>`;
}

type HistoryCall = { method: "pushState" | "replaceState"; url: string } | { method: "back" };

function setup(bodyHtml: string, options?: { bodyClass?: string; currentHref?: string }) {
	const dom = new JSDOM(
		`<!DOCTYPE html><html><head><title>Readlist — Readplace</title></head><body class="${options?.bodyClass ?? "page-readlist theme-dark"}">${bodyHtml}</body></html>`,
		{ url: QUEUE_HREF },
	);
	const document = dom.window.document;
	const historyCalls: HistoryCall[] = [];
	const navigated: string[] = [];
	const aborted: EventTarget[] = [];
	const timers: Array<{ callback: () => void; ms: number }> = [];
	const cleared: number[] = [];
	const scrolledTo: number[] = [];
	const listeners = new Map<HtmxHistoryEventName, (event: Event) => void>();
	let reloadCount = 0;
	let listScrollY = 0;
	let registrations = 0;

	function deps(): ReaderOpenDeps {
		return {
			document,
			history: {
				pushState: (_state, _title, url) => historyCalls.push({ method: "pushState", url: String(url) }),
				replaceState: (_state, _title, url) =>
					historyCalls.push({ method: "replaceState", url: String(url) }),
				back: () => historyCalls.push({ method: "back" }),
			},
			currentHref: () => options?.currentHref ?? QUEUE_HREF,
			currentPath: () => "/queue",
			navigate: (href) => navigated.push(href),
			reload: () => {
				reloadCount += 1;
			},
			scrollTo: (top) => scrolledTo.push(top),
			scrollY: () => listScrollY,
			setTimeoutFn: (callback, ms) => {
				timers.push({ callback, ms });
				return timers.length;
			},
			clearTimeoutFn: (id) => cleared.push(id),
			parseHtml: (html) => new dom.window.DOMParser().parseFromString(html, "text/html"),
			paintDelayMs: INJECTED_PAINT_DELAY_MS,
			addHtmxListener: (name, listener) => {
				registrations += 1;
				listeners.set(name, listener);
			},
		};
	}

	initReaderOpen(deps());

	function changeReadyState(xhr: EventTarget, state: { readyState: number; status: number }): void {
		Reflect.set(xhr, "readyState", state.readyState);
		Reflect.set(xhr, "status", state.status);
		xhr.dispatchEvent(new dom.window.Event("readystatechange"));
	}

	function makeXhr(response?: string): EventTarget {
		const xhr = new dom.window.EventTarget();
		Reflect.set(xhr, "abort", () => {
			aborted.push(xhr);
			changeReadyState(xhr, { readyState: 4, status: 0 });
		});
		if (response !== undefined) Reflect.set(xhr, "response", response);
		return xhr;
	}

	function fire(name: HtmxHistoryEventName, detail: unknown): Event {
		const listener = listeners.get(name);
		assert(listener, `no listener registered for ${name}`);
		const event = new dom.window.CustomEvent(name, { detail, cancelable: true });
		listener(event);
		return event;
	}

	function opener(): Element {
		const el = document.querySelector("[data-test-article-title]");
		assert(el, "the fixture must render a reader-opening anchor");
		return el;
	}

	function swapTarget(): Element {
		const main = document.querySelector("main");
		assert(main, "the fixture must render the <main> htmx resolves as the swap target");
		return main;
	}

	function beforeRequest(detailOverrides?: Record<string, unknown>): Event {
		return fire("htmx:beforeRequest", {
			elt: opener(),
			xhr: makeXhr(),
			target: swapTarget(),
			pathInfo: { finalRequestPath: READER_HREF },
			...detailOverrides,
		});
	}

	function arm(): EventTarget {
		const xhr = makeXhr();
		fire("htmx:beforeRequest", {
			elt: opener(),
			xhr,
			target: swapTarget(),
			pathInfo: { finalRequestPath: READER_HREF },
		});
		return xhr;
	}

	function banner(): Element {
		const el = document.querySelector(BANNER_SELECTOR);
		assert(el, "the fixture must render the shell's extension-suggestion banner");
		return el;
	}

	return {
		document,
		body: document.body,
		main: () => document.querySelector("main"),
		historyCalls,
		navigated,
		aborted,
		timers,
		cleared,
		fire,
		makeXhr,
		unabortableXhr: (): EventTarget => new dom.window.EventTarget(),
		beforeRequest,
		arm,
		banner,
		initAgain: () => initReaderOpen(deps()),
		dispatchLoadEnd: (xhr: EventTarget) => xhr.dispatchEvent(new dom.window.Event("loadend")),
		changeReadyState,
		reloadCount: () => reloadCount,
		scrolledTo,
		scrollListTo: (offset: number) => {
			listScrollY = offset;
		},
		registrations: () => registrations,
	};
}

function queuePage(cardHtml: string): string {
	return `<main class="readlist"><style></style>${cardHtml}${renderReaderSkeleton({ cspNonce: generateCspNonce() })}</main>`;
}

describe("initReaderOpen", () => {
	it("stamps the queue entry and pushes the reader URL on a boosted card click", () => {
		const app = setup(queuePage(realCard()));
		app.beforeRequest();
		expect(app.historyCalls).toEqual([
			{ method: "replaceState", url: QUEUE_HREF },
			{ method: "pushState", url: READER_HREF },
		]);
		expect(app.main()?.getAttribute("hx-history")).toBe("false");
		expect(app.timers).toHaveLength(1);
		expect(app.timers[0]?.ms).toBe(INJECTED_PAINT_DELAY_MS);
		expect(app.main()?.className).toBe("readlist");
		expect(app.body.classList.contains("page-readlist")).toBe(true);
		expect(app.scrolledTo).toEqual([]);
	});

	it("stamps the queue entry with its full address so a fragment survives Back", () => {
		const app = setup(queuePage(realCard()), { currentHref: `${QUEUE_HREF}#latest-saved` });
		app.beforeRequest();
		expect(app.historyCalls[0]).toEqual({ method: "replaceState", url: `${QUEUE_HREF}#latest-saved` });
	});

	it("ignores a boosted request that does not open the reader", () => {
		const app = setup(queuePage(realCard()));
		const other = app.document.querySelector("[data-test-article-url]");
		assert(other, "the site link is a boosted-but-not-opener anchor");
		app.fire("htmx:beforeRequest", { elt: other, xhr: app.makeXhr(), pathInfo: { finalRequestPath: "/x" } });
		expect(app.historyCalls).toHaveLength(0);
		expect(app.timers).toHaveLength(0);
	});

	it("ignores a reader-opening request whose detail lacks a usable xhr, target or path", () => {
		const app = setup(queuePage(realCard()));
		app.beforeRequest({ xhr: {} });
		app.beforeRequest({ xhr: app.unabortableXhr() });
		app.beforeRequest({ target: undefined });
		app.beforeRequest({ pathInfo: {} });
		expect(app.historyCalls).toHaveLength(0);
		expect(app.timers).toHaveLength(0);
	});

	it("ignores a reader opener that sits outside any card", () => {
		const app = setup(
			`<main class="readlist"><a data-opens-reader data-test-article-title href="${READER_HREF}">Loose</a>${renderReaderSkeleton({ cspNonce: generateCspNonce() })}</main>`,
		);
		app.beforeRequest();
		expect(app.historyCalls).toHaveLength(0);
		expect(app.timers).toHaveLength(0);
	});

	it("does not reload on a cache miss that carries no path", () => {
		const app = setup(queuePage(realCard()));
		const event = app.fire("htmx:historyCacheMiss", {});
		expect(event.defaultPrevented).toBe(true);
		expect(app.reloadCount()).toBe(0);
	});

	it("paints the skeleton into the swap target with the card's own title, site and read time when the response is slow", () => {
		const app = setup(queuePage(realCard()));
		app.arm();
		app.timers[0]?.callback();
		const main = app.main();
		assert(main, "main must still be present after painting");
		expect(main.className).toBe("reader");
		expect(main.getAttribute("aria-busy")).toBe("true");
		const slot = main.querySelector("[data-test-reader-skeleton]");
		assert(slot, "the painted main must hold the skeleton's loading slot");
		expect(slot.getAttribute("data-reader-status")).toBe("loading");
		expect(main.querySelector('[data-reader-field-text="title"]')?.textContent).toBe("Article Title");
		expect(main.querySelector('[data-reader-field-text="site"]')?.textContent).toBe("example.com");
		const readTime = main.querySelector('[data-reader-field-text="read-time"]');
		expect(readTime?.textContent).toBe("3 min read");
		expect(readTime?.classList.contains("article-body__read-time--empty")).toBe(false);
		expect(main.querySelector("[data-reader-field-href]")?.getAttribute("href")).toBe(
			"https://example.com/post",
		);
		expect(app.body.classList.contains("page-reader")).toBe(true);
		expect(app.body.classList.contains("page-distraction-free")).toBe(true);
		expect(app.body.classList.contains("page-readlist")).toBe(false);
		expect(app.body.classList.contains("theme-dark")).toBe(true);
		expect(app.scrolledTo).toEqual([0]);
		expect(main.querySelectorAll("[id]").length).toBe(0);
	});

	it("marks the read time empty when the card has none to copy", () => {
		const app = setup(queuePage(realCard({ readTime: undefined })));
		app.arm();
		app.timers[0]?.callback();
		const readTime = app.main()?.querySelector('[data-reader-field-text="read-time"]');
		expect(readTime?.textContent).toBe("");
		expect(readTime?.classList.contains("article-body__read-time--empty")).toBe(true);
	});

	it("leaves a copied field blank when the card lacks that field entirely", () => {
		const app = setup(queuePage(TITLE_ONLY_CARD));
		app.arm();
		app.timers[0]?.callback();
		const main = app.main();
		expect(main?.querySelector('[data-reader-field-text="site"]')?.textContent).toBe("");
		expect(main?.querySelector("[data-reader-field-href]")?.getAttribute("href")).toBe("");
	});

	it("commits the final body class from the response and scrolls once when the response beats the timer", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		Reflect.set(xhr, "response", readerResponse("page-reader theme-dark"));
		const historyUpdate = { type: "push" };
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: historyUpdate });
		expect(app.cleared).toContain(1);
		expect(historyUpdate.type).toBe("replace");
		expect(app.body.className).toBe("page-reader theme-dark");
		expect(app.scrolledTo).toEqual([0]);
		expect(app.main()?.className).toBe("readlist");
	});

	it("does not scroll a second time when the skeleton had already painted", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		app.timers[0]?.callback();
		Reflect.set(xhr, "response", readerResponse("page-reader theme-dark"));
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: { type: "push" } });
		expect(app.scrolledTo).toEqual([0]);
		expect(app.body.className).toBe("page-reader theme-dark");
	});

	it("falls back to the template body class when the response carries none", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: { type: "push" } });
		expect(app.body.classList.contains("page-reader")).toBe(true);
		expect(app.body.classList.contains("page-distraction-free")).toBe(true);
		expect(app.body.classList.contains("page-readlist")).toBe(false);
		expect(app.scrolledTo).toEqual([0]);
	});

	it("replaces the shell banner with the response's so a failed article's suggestion shows after the fill", () => {
		const app = setup(shellBanner("false") + queuePage(realCard()));
		const xhr = app.arm();
		Reflect.set(xhr, "response", readerResponse("page-reader theme-dark", { banner: shellBanner("true") }));
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: { type: "push" } });
		const banner = app.banner();
		expect(banner.getAttribute("data-show-extension-suggestion")).toBe("true");
		expect(banner.parentElement?.className).toBe("banner-area");
		expect(app.document.querySelectorAll(BANNER_SELECTOR).length).toBe(1);
	});

	it("keeps the live shell banner when the response carries none", () => {
		const app = setup(shellBanner("false") + queuePage(realCard()));
		const before = app.banner();
		const xhr = app.arm();
		Reflect.set(xhr, "response", readerResponse("page-reader theme-dark"));
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: { type: "push" } });
		expect(app.banner()).toBe(before);
		expect(app.banner().getAttribute("data-show-extension-suggestion")).toBe("false");
	});

	it("ignores the response's banner on a page that renders no shell banner", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		Reflect.set(xhr, "response", readerResponse("page-reader theme-dark", { banner: shellBanner("true") }));
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: { type: "push" } });
		expect(Array.from(app.body.children).map((el) => el.tagName)).toEqual(["MAIN"]);
		expect(app.body.className).toBe("page-reader theme-dark");
	});

	it("ignores a history update for a different request", () => {
		const app = setup(queuePage(realCard()));
		app.arm();
		app.fire("htmx:beforeHistoryUpdate", { xhr: app.makeXhr(), history: { type: "push" } });
		expect(app.cleared).toHaveLength(0);
		expect(app.body.classList.contains("page-readlist")).toBe(true);
	});

	it("leaves an unrelated history update alone when no open is pending", () => {
		const app = setup(queuePage(realCard()));
		const historyUpdate = { type: "push" };
		app.fire("htmx:beforeHistoryUpdate", { xhr: app.makeXhr(), history: historyUpdate });
		expect(historyUpdate.type).toBe("push");
		expect(app.cleared).toEqual([]);
		expect(app.scrolledTo).toEqual([]);
		expect(app.body.className).toBe("page-readlist theme-dark");
	});

	it("gives a boosted swap out of the reader its destination's body class, so marking read brings the queue's chrome back", () => {
		const app = setup('<main class="reader" hx-history="false"></main>', {
			bodyClass: "page-reader page-distraction-free theme-dark",
		});
		const historyUpdate = { type: "push" };
		app.fire("htmx:beforeHistoryUpdate", {
			xhr: app.makeXhr(readerResponse("page-readlist theme-dark")),
			history: historyUpdate,
		});
		expect(app.body.className).toBe("page-readlist theme-dark");
		expect(historyUpdate.type).toBe("push");
		expect(app.scrolledTo).toEqual([]);
	});

	it("falls back to a plain navigation when the request ends without committing", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		app.dispatchLoadEnd(xhr);
		expect(app.navigated).toEqual([READER_HREF]);
		expect(app.cleared).toContain(1);
	});

	it("keeps the list on screen when a tap fails to reach the network before the skeleton paints, taking the article off the history", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();

		app.changeReadyState(xhr, { readyState: 4, status: 0 });
		app.dispatchLoadEnd(xhr);

		expect(app.navigated).toEqual([]);
		expect(app.historyCalls).toEqual([
			{ method: "replaceState", url: QUEUE_HREF },
			{ method: "pushState", url: READER_HREF },
			{ method: "back" },
		]);
		expect(app.main()?.hasAttribute("hx-history")).toBe(false);
		expect(app.main()?.className).toBe("readlist");
		expect(app.body.className).toBe("page-readlist theme-dark");
		expect(app.cleared).toContain(1);
	});

	it("cancels the one htmx restore its own step back sets off, so the list on screen is not swapped for a snapshot of itself", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		app.changeReadyState(xhr, { readyState: 4, status: 0 });
		app.dispatchLoadEnd(xhr);

		const stepBack = app.fire("htmx:historyCacheHit", {});
		const later = app.fire("htmx:historyCacheHit", {});

		expect(stepBack.defaultPrevented).toBe(true);
		expect(later.defaultPrevented).toBe(false);
		expect(app.reloadCount()).toBe(0);
	});

	it("cancels its own step back's restore when htmx holds no snapshot of the list, and only that one", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		app.changeReadyState(xhr, { readyState: 4, status: 0 });
		app.dispatchLoadEnd(xhr);

		const stepBack = app.fire("htmx:historyCacheMiss", { path: "/queue" });
		const later = app.fire("htmx:historyCacheHit", {});

		expect(stepBack.defaultPrevented).toBe(true);
		expect(later.defaultPrevented).toBe(false);
		expect(app.reloadCount()).toBe(0);
	});

	it("keeps the list in the document, hidden, while the skeleton shows, so its every-3s card polls keep running", () => {
		const app = setup(queuePage(realCard()));
		const opener = app.document.querySelector("[data-test-article-title]");
		app.arm();

		app.timers[0]?.callback();

		expect(opener?.isConnected).toBe(true);
		expect(opener?.closest("main > [hidden]")).not.toBeNull();
		expect(app.main()?.querySelector("[data-test-reader-skeleton]")?.closest("[hidden]")).toBeNull();
	});

	it("puts the very list back, before htmx reports the failure, when a tap fails to reach the network after the skeleton painted", () => {
		const app = setup(queuePage(realCard()));
		const main = app.main();
		assert(main, "the queue page must render its main");
		const listNodes = Array.from(main.childNodes);
		const xhr = app.arm();
		app.timers[0]?.callback();

		app.changeReadyState(xhr, { readyState: 4, status: 0 });

		const restored = Array.from(main.childNodes);
		expect(restored).toHaveLength(listNodes.length);
		for (const [index, node] of restored.entries()) expect(node).toBe(listNodes[index]);
		expect(main.className).toBe("readlist");
		expect(main.hasAttribute("aria-busy")).toBe(false);
		expect(main.hasAttribute("hx-history")).toBe(false);
		expect(app.body.className).toBe("page-readlist theme-dark");
		expect(app.historyCalls.at(-1)).toEqual({ method: "back" });
		app.dispatchLoadEnd(xhr);
		expect(app.navigated).toEqual([]);
	});

	it("brings the list back where the reader left it, scrolled to the same offset with the tapped link focused in place, when a tap fails after the skeleton painted", () => {
		const app = setup(queuePage(realCard()));
		const opener = app.document.querySelector("[data-test-article-title]");
		assert(opener, "the card must render its title link");
		const focusCalls: unknown[] = [];
		Object.defineProperty(opener, "focus", { value: (options: unknown) => focusCalls.push(options) });
		app.scrollListTo(840);
		const xhr = app.arm();
		app.timers[0]?.callback();

		app.changeReadyState(xhr, { readyState: 4, status: 0 });

		expect(app.scrolledTo).toEqual([0, 840]);
		expect(focusCalls).toEqual([{ preventScroll: true }]);
	});

	it("still navigates to the article when the server answers with an error", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();

		app.changeReadyState(xhr, { readyState: 4, status: 500 });
		app.dispatchLoadEnd(xhr);

		expect(app.navigated).toEqual([READER_HREF]);
		expect(app.historyCalls).toHaveLength(2);
	});

	it("waits for the request to finish before judging it", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();

		app.changeReadyState(xhr, { readyState: 2, status: 200 });

		expect(app.historyCalls).toHaveLength(2);
		expect(app.main()?.getAttribute("hx-history")).toBe("false");
	});

	it("does not navigate once the response has committed", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		Reflect.set(xhr, "response", readerResponse("page-reader theme-dark"));
		app.fire("htmx:beforeHistoryUpdate", { xhr, history: { type: "push" } });
		app.dispatchLoadEnd(xhr);
		expect(app.navigated).toHaveLength(0);
	});

	it("cancels a second reader click while one is still pending", () => {
		const app = setup(queuePage(realCard()));
		app.arm();
		const second = app.beforeRequest();
		expect(second.defaultPrevented).toBe(true);
		expect(app.timers).toHaveLength(1);
	});

	it("aborts the open, cancels the htmx cache hit and reloads when Back lands during the skeleton", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		const event = app.fire("htmx:historyCacheHit", {});
		expect(event.defaultPrevented).toBe(true);
		expect(app.aborted).toEqual([xhr]);
		expect(app.cleared).toEqual([1]);
		expect(app.reloadCount()).toBe(1);
		expect(app.historyCalls).toHaveLength(2);
		app.dispatchLoadEnd(xhr);
		expect(app.navigated).toEqual([]);
	});

	it("reloads a cache hit on the reader page itself, where no open was ever armed", () => {
		const app = setup('<main class="reader" hx-history="false"></main>', { bodyClass: "page-reader" });
		const event = app.fire("htmx:historyCacheHit", {});
		expect(event.defaultPrevented).toBe(true);
		expect(app.reloadCount()).toBe(1);
		expect(app.aborted).toEqual([]);
		expect(app.navigated).toEqual([]);
	});

	it("leaves an ordinary cache hit alone when nothing refuses a snapshot", () => {
		const app = setup(queuePage(realCard()));
		const event = app.fire("htmx:historyCacheHit", {});
		expect(event.defaultPrevented).toBe(false);
		expect(app.reloadCount()).toBe(0);
	});

	it("reloads on a cache miss to a different path", () => {
		const app = setup(queuePage(realCard()));
		const event = app.fire("htmx:historyCacheMiss", { path: "/queue/abc123/view" });
		expect(event.defaultPrevented).toBe(true);
		expect(app.reloadCount()).toBe(1);
		expect(app.aborted).toEqual([]);
	});

	it("does not reload on a same-path cache miss", () => {
		const app = setup(queuePage(realCard()));
		const event = app.fire("htmx:historyCacheMiss", { path: "/queue" });
		expect(event.defaultPrevented).toBe(true);
		expect(app.reloadCount()).toBe(0);
	});

	it("aborts the pending open and reloads on a cache miss during the skeleton", () => {
		const app = setup(queuePage(realCard()));
		const xhr = app.arm();
		app.fire("htmx:historyCacheMiss", { path: "/queue" });
		expect(app.aborted).toEqual([xhr]);
		expect(app.reloadCount()).toBe(1);
		app.dispatchLoadEnd(xhr);
		expect(app.navigated).toEqual([]);
	});

	it("tracks the current path from every htmx history event", () => {
		const app = setup(queuePage(realCard()));
		app.fire("htmx:pushedIntoHistory", { path: "/queue?queue=work" });
		expect(app.fire("htmx:historyCacheMiss", { path: "/queue?queue=work" }).defaultPrevented).toBe(true);
		expect(app.reloadCount()).toBe(0);
		app.fire("htmx:replacedInHistory", { path: "/queue?queue=work&page=2" });
		app.fire("htmx:historyCacheMiss", { path: "/queue?queue=work&page=2" });
		expect(app.reloadCount()).toBe(0);
		app.fire("htmx:historyRestore", { path: "/queue?queue=work" });
		app.fire("htmx:historyCacheMiss", { path: "/queue?queue=work" });
		expect(app.reloadCount()).toBe(0);
		app.fire("htmx:historyCacheMiss", { path: "/queue" });
		expect(app.reloadCount()).toBe(1);
	});

	it("binds only once even if the bundle footer runs again after a history restore", () => {
		const app = setup(queuePage(realCard()));
		app.initAgain();
		expect(app.registrations()).toBe(7);
	});

	it("throws when the queue page ships no skeleton template", () => {
		const app = setup(`<main class="readlist">${realCard()}</main>`);
		app.arm();
		assert.throws(() => app.timers[0]?.callback(), /reader skeleton template/);
	});
});
