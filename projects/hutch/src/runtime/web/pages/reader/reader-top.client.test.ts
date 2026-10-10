import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReaderTop } from "./reader-top.client";

const SCROLLED = "page-scrolled";
const VIEWPORT_HEIGHT = 800;

function makeDocument(): Document {
	return new JSDOM("<!doctype html><html><body><main class=\"reader\"></main></body></html>").window
		.document;
}

function createFakeWindow(initialScrollY: number) {
	let scrollY = initialScrollY;
	let listener: (() => void) | null = null;
	return {
		win: {
			get scrollY(): number {
				return scrollY;
			},
			innerHeight: VIEWPORT_HEIGHT,
			addEventListener(_type: "scroll", l: () => void, _options: { passive: true }): void {
				listener = l;
			},
		},
		scrollTo(value: number): void {
			scrollY = value;
			assert(listener, "the scroll listener must be attached");
			listener();
		},
	};
}

describe("initReaderTop", () => {
	it("marks the page scrolled at init when it loads more than one viewport down", () => {
		const doc = makeDocument();

		initReaderTop({ document: doc, window: createFakeWindow(VIEWPORT_HEIGHT + 1).win });

		expect(doc.documentElement.classList.contains(SCROLLED)).toBe(true);
	});

	it("leaves the page unmarked at init when it loads at the top", () => {
		const doc = makeDocument();

		initReaderTop({ document: doc, window: createFakeWindow(0).win });

		expect(doc.documentElement.classList.contains(SCROLLED)).toBe(false);
	});

	it("marks the page scrolled once the reader scrolls past one viewport", () => {
		const doc = makeDocument();
		const fake = createFakeWindow(0);
		initReaderTop({ document: doc, window: fake.win });

		fake.scrollTo(VIEWPORT_HEIGHT);
		const atOneViewport = doc.documentElement.classList.contains(SCROLLED);
		fake.scrollTo(VIEWPORT_HEIGHT + 1);

		expect([atOneViewport, doc.documentElement.classList.contains(SCROLLED)]).toEqual([false, true]);
	});

	it("unmarks the page once the reader scrolls back to one viewport or less", () => {
		const doc = makeDocument();
		const fake = createFakeWindow(VIEWPORT_HEIGHT * 3);
		initReaderTop({ document: doc, window: fake.win });

		fake.scrollTo(VIEWPORT_HEIGHT);

		expect(doc.documentElement.classList.contains(SCROLLED)).toBe(false);
	});
});
