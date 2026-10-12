import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import { initTableOfContents } from "./table-of-contents.client";
import { renderTableOfContents } from "./table-of-contents.component";

const APP_ORIGIN = "https://readplace.com";
const SCROLL_PADDING_TOP = "52px";
const HEADED_CONTENT = "<h2>Alpha</h2><p>One</p><h3>Beta</h3><p>Two</p><h2>Gamma</h2><p>Three</p>";

function readerHtml(content: string): string {
	const tableOfContents = renderTableOfContents({
		crawl: { status: "ready" },
		content,
		notice: undefined,
		appOrigin: APP_ORIGIN,
		oob: false,
	});
	return `${tableOfContents}${renderReaderReady({ content, appOrigin: APP_ORIGIN })}`;
}

const PENDING_READER_HTML = renderTableOfContents({
	crawl: { status: "pending" },
	content: undefined,
	notice: undefined,
	appOrigin: APP_ORIGIN,
	oob: false,
});

function makeDocument(bodyHtml: string): Document {
	return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`).window.document;
}

function placeHeadings(doc: Document, tops: Record<string, number>): void {
	for (const [id, top] of Object.entries(tops)) {
		const heading = doc.getElementById(id);
		assert(heading, `the fixture must hold #${id}`);
		Object.defineProperty(heading, "getBoundingClientRect", {
			value: () => ({ top }),
			configurable: true,
		});
	}
}

function currentRows(doc: Document): { href: string | null; marked: boolean }[] {
	return Array.from(doc.querySelectorAll('.table-of-contents__link[aria-current="location"]'), (link) => ({
		href: link.getAttribute("href"),
		marked: link.classList.contains("table-of-contents__link--current"),
	}));
}

function createFakeWindow() {
	let scrollListener: (() => void) | null = null;
	const frames: (() => void)[] = [];
	return {
		win: {
			addEventListener(_type: "scroll", listener: () => void, _options: { passive: true }): void {
				scrollListener = listener;
			},
			requestAnimationFrame(callback: () => void): number {
				frames.push(callback);
				return frames.length;
			},
			getComputedStyle(_element: Element): { scrollPaddingTop: string } {
				return { scrollPaddingTop: SCROLL_PADDING_TOP };
			},
		},
		scroll(): void {
			assert(scrollListener, "the scroll listener must be attached");
			scrollListener();
		},
		requestedFrames(): number {
			return frames.length;
		},
		paintFrame(): void {
			for (const frame of frames.splice(0)) frame();
		},
	};
}

function createSettle() {
	let settleListener: (() => void) | null = null;
	return {
		addSettleListener(listener: () => void): void {
			settleListener = listener;
		},
		settle(): void {
			assert(settleListener, "the settle listener must be attached");
			settleListener();
		},
	};
}

describe("initTableOfContents", () => {
	it("marks the first row current while no heading has reached the top of the page", () => {
		const doc = makeDocument(readerHtml(HEADED_CONTENT));
		placeHeadings(doc, { "section-alpha": 300, "section-beta": 900, "section-gamma": 1500 });

		initTableOfContents({ document: doc, window: createFakeWindow().win, addSettleListener: createSettle().addSettleListener });

		expect(currentRows(doc)).toEqual([{ href: "#section-alpha", marked: true }]);
	});

	it("moves the current row to the last heading scrolled up to the scroll padding, and keeps only that row marked", () => {
		const doc = makeDocument(readerHtml(HEADED_CONTENT));
		placeHeadings(doc, { "section-alpha": 300, "section-beta": 900, "section-gamma": 1500 });
		const fake = createFakeWindow();
		initTableOfContents({ document: doc, window: fake.win, addSettleListener: createSettle().addSettleListener });

		placeHeadings(doc, { "section-alpha": -600, "section-beta": 52.5, "section-gamma": 600 });
		fake.scroll();
		fake.paintFrame();

		expect(currentRows(doc)).toEqual([{ href: "#section-beta", marked: true }]);
		expect(doc.querySelectorAll(".table-of-contents__link--current")).toHaveLength(1);
	});

	it("syncs once per animation frame however many scroll events arrive before it paints", () => {
		const doc = makeDocument(readerHtml(HEADED_CONTENT));
		placeHeadings(doc, { "section-alpha": 300, "section-beta": 900, "section-gamma": 1500 });
		const fake = createFakeWindow();
		initTableOfContents({ document: doc, window: fake.win, addSettleListener: createSettle().addSettleListener });

		fake.scroll();
		fake.scroll();
		fake.scroll();
		const requestedInOneFrame = fake.requestedFrames();
		fake.paintFrame();
		fake.scroll();

		expect([requestedInOneFrame, fake.requestedFrames()]).toEqual([1, 1]);
	});

	it("marks the first row of a card that a poll swaps in once htmx settles", () => {
		const doc = makeDocument(PENDING_READER_HTML);
		const settle = createSettle();
		initTableOfContents({ document: doc, window: createFakeWindow().win, addSettleListener: settle.addSettleListener });

		doc.body.innerHTML = readerHtml(HEADED_CONTENT);
		placeHeadings(doc, { "section-alpha": 300, "section-beta": 900, "section-gamma": 1500 });
		settle.settle();

		expect(currentRows(doc)).toEqual([{ href: "#section-alpha", marked: true }]);
	});

	it("does nothing on a page with no rows, and keeps listening for one to arrive", () => {
		const doc = makeDocument(PENDING_READER_HTML);
		const fake = createFakeWindow();
		initTableOfContents({ document: doc, window: fake.win, addSettleListener: createSettle().addSettleListener });
		fake.scroll();
		fake.paintFrame();
		const pendingPage = doc.body.innerHTML;

		doc.body.innerHTML = readerHtml(HEADED_CONTENT);
		placeHeadings(doc, { "section-alpha": -600, "section-beta": 900, "section-gamma": 1500 });
		fake.scroll();
		fake.paintFrame();

		expect(pendingPage).toBe(PENDING_READER_HTML);
		expect(currentRows(doc)).toEqual([{ href: "#section-alpha", marked: true }]);
	});

	it("finds a heading with a non-ASCII id through the row's raw href", () => {
		const doc = makeDocument(readerHtml("<h2>Alpha</h2><p>One</p><h2>読書の楽しみ</h2><p>Two</p>"));
		placeHeadings(doc, { "section-alpha": -400, "section-読書の楽しみ": 40 });

		initTableOfContents({ document: doc, window: createFakeWindow().win, addSettleListener: createSettle().addSettleListener });

		expect(currentRows(doc)).toEqual([{ href: "#section-読書の楽しみ", marked: true }]);
	});

	it("refuses a card whose row links to a heading the page does not hold", () => {
		const doc = makeDocument(readerHtml(HEADED_CONTENT));
		const beta = doc.getElementById("section-beta");
		assert(beta, "the fixture must hold #section-beta");
		beta.removeAttribute("id");

		expect(() =>
			initTableOfContents({ document: doc, window: createFakeWindow().win, addSettleListener: createSettle().addSettleListener }),
		).toThrow("the reader content holds the heading that #section-beta links to");
	});
});
