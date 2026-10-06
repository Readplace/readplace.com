import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import { offlineCardOpenScript } from "./offline-card-open-script";

const LISTING_URL = "https://readplace.test/queue";
const READER_URL = "https://readplace.test/queue/abc123/view?v=token";
const NAVIGATION = "Not implemented: navigation (except hash changes)";

const LISTING_MAIN = `<main class="readlist">
	<article class="readlist-article">
		<a data-opens-reader data-reader-field="title" href="/queue/abc123/view?v=token"><span data-test-title-text>Article Title</span></a>
		<a data-test-site-link href="https://example.com/post">example.com</a>
	</article>
</main>`;

interface WorkerAsk {
	url: unknown;
	init: unknown;
}

interface WorkerAnswer {
	resolve: (response: unknown) => void;
	reject: (reason: unknown) => void;
}

function openListing(options: { htmxLoaded: boolean }) {
	const asks: WorkerAsk[] = [];
	const answers: WorkerAnswer[] = [];
	const navigations: string[] = [];
	const failedRequestSenders: Array<EventTarget | null> = [];
	const virtualConsole = new VirtualConsole();
	virtualConsole.on("jsdomError", (error) => navigations.push(error.message));
	const dom = new JSDOM(
		`<!DOCTYPE html><html><body>${LISTING_MAIN}${offlineCardOpenScript(generateCspNonce())}</body></html>`,
		{
			url: LISTING_URL,
			runScripts: "dangerously",
			virtualConsole,
			beforeParse(window) {
				Object.defineProperty(window, "fetch", {
					value: (url: unknown, init: unknown) => {
						asks.push({ url, init });
						return new Promise((resolve, reject) => answers.push({ resolve, reject }));
					},
				});
				if (options.htmxLoaded) Object.defineProperty(window, "htmx", { value: {} });
			},
		},
	);
	const { document, MouseEvent } = dom.window;
	document.addEventListener("htmx:sendError", (event) => failedRequestSenders.push(event.target));

	function pick(selector: string): Element {
		const element = document.querySelector(selector);
		assert(element, `${selector} must be rendered`);
		return element;
	}

	function pendingAnswer(): WorkerAnswer {
		const [answer] = answers;
		assert(answer, "the tap must have asked for the article");
		return answer;
	}

	return {
		asks,
		navigations,
		failedRequestSenders,
		opener: () => pick("[data-opens-reader]"),
		tap(input: { on: string; init?: MouseEventInit }): boolean {
			return pick(input.on).dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...input.init }),
			);
		},
		articleArrives: () => pendingAnswer().resolve({ ok: true }),
		articleUnreachable: () => pendingAnswer().reject(new TypeError("Failed to fetch")),
	};
}

function settled(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("offlineCardOpenScript", () => {
	it("runs under the page's CSP nonce", () => {
		const nonce = generateCspNonce();

		const script = new JSDOM(offlineCardOpenScript(nonce)).window.document.querySelector("script");

		expect(script?.getAttribute("nonce")).toBe(nonce);
	});

	it("asks the worker for the article as a boosted page and holds the tap until it answers, on a listing whose htmx never loaded", () => {
		const listing = openListing({ htmxLoaded: false });

		const proceeded = listing.tap({ on: "[data-test-title-text]" });

		expect(proceeded).toBe(false);
		expect(listing.asks).toEqual([{ url: READER_URL, init: { headers: { "HX-Boosted": "true" } } }]);
		expect(listing.navigations).toEqual([]);
	});

	it("opens the article once the worker answers with it", async () => {
		const listing = openListing({ htmxLoaded: false });
		listing.tap({ on: "[data-test-title-text]" });

		listing.articleArrives();
		await settled();

		expect(listing.navigations).toEqual([NAVIGATION]);
		expect(listing.failedRequestSenders).toEqual([]);
	});

	it("keeps the list and reports the failed request from the tapped link, so the shell raises the offline banner, when the article cannot be reached", async () => {
		const listing = openListing({ htmxLoaded: false });
		listing.tap({ on: "[data-test-title-text]" });

		listing.articleUnreachable();
		await settled();

		expect(listing.navigations).toEqual([]);
		expect(listing.failedRequestSenders).toHaveLength(1);
		expect(listing.failedRequestSenders[0]).toBe(listing.opener());
	});

	it("leaves the tap to htmx once htmx has loaded", () => {
		const listing = openListing({ htmxLoaded: true });

		const proceeded = listing.tap({ on: "[data-test-title-text]" });

		expect(proceeded).toBe(true);
		expect(listing.asks).toEqual([]);
	});

	it.each<[string, MouseEventInit]>([
		["a middle click", { button: 1 }],
		["a Cmd click", { metaKey: true }],
		["a Ctrl click", { ctrlKey: true }],
		["a Shift click", { shiftKey: true }],
		["an Alt click", { altKey: true }],
	])("leaves %s on a card to the browser", (_name, init) => {
		const listing = openListing({ htmxLoaded: false });

		const proceeded = listing.tap({ on: "[data-test-title-text]", init });

		expect(proceeded).toBe(true);
		expect(listing.asks).toEqual([]);
	});

	it("leaves a tap on a link that does not open the reader to the browser", () => {
		const listing = openListing({ htmxLoaded: false });

		const proceeded = listing.tap({ on: "[data-test-site-link]" });

		expect(proceeded).toBe(true);
		expect(listing.asks).toEqual([]);
	});
});
