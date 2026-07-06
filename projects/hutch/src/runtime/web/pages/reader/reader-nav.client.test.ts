import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReaderNav } from "./reader-nav.client";

const HIDDEN = "nav-hidden";
const HEADER_HEIGHT = 64;
const HEADER = `<header class="header"></header>`;

function readerMain(): string {
	return `<main class="reader"><div data-article-body></div></main>`;
}

function plainMain(): string {
	return `<main class="queue"></main>`;
}

function makeDocument(bodyHtml: string): Document {
	return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`).window
		.document;
}

function setHeaderHeight(doc: Document, value: number): void {
	const el = doc.querySelector<HTMLElement>(".header");
	assert(el, ".header must exist in fixture");
	Object.defineProperty(el, "offsetHeight", { value, configurable: true });
}

/** A scroll-aware window stub: `scrollTo` moves the position and fires the
 * registered listener; `hasListener` proves the feature attached (or didn't). */
function createFakeWindow() {
	let scrollY = 0;
	let listener: (() => void) | null = null;
	return {
		win: {
			get scrollY(): number {
				return scrollY;
			},
			addEventListener(
				_type: "scroll",
				l: () => void,
				_options: { passive: true },
			): void {
				listener = l;
			},
		},
		scrollTo(value: number): void {
			scrollY = value;
			if (listener !== null) listener();
		},
		hasListener(): boolean {
			return listener !== null;
		},
	};
}

function createSwap() {
	let cb: (() => void) | null = null;
	return {
		addSwapListener(listener: () => void): void {
			cb = listener;
		},
		fire(): void {
			if (cb !== null) cb();
		},
		hasListener(): boolean {
			return cb !== null;
		},
	};
}

function start(
	doc: Document,
	fake: ReturnType<typeof createFakeWindow>,
	swap: ReturnType<typeof createSwap>,
): void {
	initReaderNav({
		document: doc,
		window: fake.win,
		addSwapListener: swap.addSwapListener,
	});
}

function isHidden(doc: Document): boolean {
	return doc.documentElement.classList.contains(HIDDEN);
}

describe("initReaderNav — gating", () => {
	it("is a no-op with no listeners when there is no .header", () => {
		const doc = makeDocument(readerMain());
		const fake = createFakeWindow();
		const swap = createSwap();

		start(doc, fake, swap);
		fake.scrollTo(500);

		assert.equal(fake.hasListener(), false);
		assert.equal(swap.hasListener(), false);
		assert.equal(isHidden(doc), false);
	});

	it("attaches but never hides the nav on a non-reader page", () => {
		const doc = makeDocument(HEADER + plainMain());
		const fake = createFakeWindow();
		const swap = createSwap();
		setHeaderHeight(doc, HEADER_HEIGHT);

		start(doc, fake, swap);
		assert.equal(fake.hasListener(), true);
		fake.scrollTo(500);

		assert.equal(isHidden(doc), false);
	});
});

describe("initReaderNav — scroll direction on a reader page", () => {
	function startReader() {
		const doc = makeDocument(HEADER + readerMain());
		const fake = createFakeWindow();
		const swap = createSwap();
		setHeaderHeight(doc, HEADER_HEIGHT);
		start(doc, fake, swap);
		return { doc, fake, swap };
	}

	it("hides the nav when scrolling down past the header", () => {
		const { doc, fake } = startReader();

		fake.scrollTo(200);

		assert.equal(isHidden(doc), true);
	});

	it("shows the nav again when scrolling up", () => {
		const { doc, fake } = startReader();

		fake.scrollTo(200); // hidden
		fake.scrollTo(100); // scrolled up

		assert.equal(isHidden(doc), false);
	});

	it("always shows the nav near the top of the page", () => {
		const { doc, fake } = startReader();

		fake.scrollTo(200); // hidden
		fake.scrollTo(30); // within header height of the top

		assert.equal(isHidden(doc), false);
	});

	it("ignores jitter smaller than the delta", () => {
		const { doc, fake } = startReader();

		fake.scrollTo(200); // hidden
		fake.scrollTo(203); // +3px, below the delta

		assert.equal(isHidden(doc), true);
	});
});

describe("initReaderNav — hx-boost lifecycle", () => {
	function readerDoc() {
		const doc = makeDocument(HEADER + readerMain());
		const fake = createFakeWindow();
		const swap = createSwap();
		setHeaderHeight(doc, HEADER_HEIGHT);
		start(doc, fake, swap);
		return { doc, fake, swap };
	}

	it("keeps the hidden nav hidden across an inner OOB swap (same <main>)", () => {
		const { doc, fake, swap } = readerDoc();
		fake.scrollTo(200); // hidden

		swap.fire(); // <main> unchanged — an OOB progress poll

		assert.equal(isHidden(doc), true);
	});

	it("restores the nav when a swap navigates out of the reader", () => {
		const { doc, fake, swap } = readerDoc();
		fake.scrollTo(200); // hidden

		const main = doc.querySelector("main");
		assert(main, "reader fixture must have a <main>");
		main.outerHTML = plainMain(); // boosted away to a non-reader page
		swap.fire();

		assert.equal(isHidden(doc), false);
	});

	it("activates hiding after a swap navigates into the reader", () => {
		const doc = makeDocument(HEADER + plainMain());
		const fake = createFakeWindow();
		const swap = createSwap();
		setHeaderHeight(doc, HEADER_HEIGHT);
		start(doc, fake, swap);

		fake.scrollTo(200); // non-reader: nav stays shown
		assert.equal(isHidden(doc), false);

		const main = doc.querySelector("main");
		assert(main, "fixture must have a <main>");
		main.outerHTML = readerMain(); // boosted into a reader
		swap.fire();

		fake.scrollTo(400); // now scrolling down hides the nav

		assert.equal(isHidden(doc), true);
	});
});
