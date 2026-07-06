import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReaderNav } from "./reader-nav.client";

const HIDDEN = "nav-hidden";
const HEADER_HEIGHT = 64;
const HEADER = `<header class="header"></header>`;

// The script hides on scroll wherever it is injected — which pages opt in is
// the server's concern. A <main> is present so onSwap's identity check has
// something to track.
function bodyWithHeader(): string {
	return `${HEADER}<main class="reader"></main>`;
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

function startNav() {
	const doc = makeDocument(bodyWithHeader());
	const fake = createFakeWindow();
	const swap = createSwap();
	setHeaderHeight(doc, HEADER_HEIGHT);
	start(doc, fake, swap);
	return { doc, fake, swap };
}

describe("initReaderNav — attaching", () => {
	it("is a no-op with no listeners when there is no .header", () => {
		const doc = makeDocument(`<main class="reader"></main>`);
		const fake = createFakeWindow();
		const swap = createSwap();

		start(doc, fake, swap);
		fake.scrollTo(500);

		assert.equal(fake.hasListener(), false);
		assert.equal(swap.hasListener(), false);
		assert.equal(isHidden(doc), false);
	});
});

describe("initReaderNav — scroll direction", () => {
	it("hides the nav when scrolling down past the header", () => {
		const { doc, fake } = startNav();

		fake.scrollTo(200);

		assert.equal(isHidden(doc), true);
	});

	it("shows the nav again when scrolling up", () => {
		const { doc, fake } = startNav();

		fake.scrollTo(200); // hidden
		fake.scrollTo(100); // scrolled up

		assert.equal(isHidden(doc), false);
	});

	it("always shows the nav near the top of the page", () => {
		const { doc, fake } = startNav();

		fake.scrollTo(200); // hidden
		fake.scrollTo(30); // within header height of the top

		assert.equal(isHidden(doc), false);
	});

	it("ignores jitter smaller than the delta", () => {
		const { doc, fake } = startNav();

		fake.scrollTo(200); // hidden
		fake.scrollTo(203); // +3px, below the delta

		assert.equal(isHidden(doc), true);
	});
});

describe("initReaderNav — hx-boost lifecycle", () => {
	it("keeps the hidden nav hidden across an inner OOB swap (same <main>)", () => {
		const { doc, fake, swap } = startNav();
		fake.scrollTo(200); // hidden

		swap.fire(); // <main> unchanged — an OOB progress poll

		assert.equal(isHidden(doc), true);
	});

	it("shows and re-arms the nav on a real <main> swap", () => {
		const { doc, fake, swap } = startNav();
		fake.scrollTo(200); // hidden

		const main = doc.querySelector("main");
		assert(main, "fixture must have a <main>");
		main.outerHTML = `<main class="reader"></main>`; // a mark-read / save re-render
		swap.fire();

		assert.equal(isHidden(doc), false);
	});
});
