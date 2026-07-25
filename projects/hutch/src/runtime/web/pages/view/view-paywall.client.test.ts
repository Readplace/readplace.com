import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PAYWALL_REVEALED_EVENT } from "../../shared/paywall-revealed-event";
import { initShareBalloon } from "../../shared/share-balloon/share-balloon.client";
import { initViewPaywall } from "./view-paywall.client";

const ACTIVE = "view__paywall--active";
const INACTIVE = "view__paywall--inactive";
const START_MS = Date.parse("2026-05-01T00:00:00.000Z");
const EXPIRED_ISO = "2026-04-30T23:59:59.000Z"; // before START
const COUNTING_ISO = "2026-05-01T00:00:05.000Z"; // 5s after START
const ARTICLE_HEIGHT = 1000; // 10% scroll threshold = 100px
const PAST_THRESHOLD = 250;

function paywallMarkup(expiresAtAttr: string): string {
	return `<div class="view__paywall view__paywall--inactive" data-view-paywall data-test-view-paywall data-paywall-active="false"${expiresAtAttr}>
		<div class="view__paywall-fade"></div>
		<div class="view__paywall-modal">
			<a class="btn btn--primary" href="/save?url=x" data-test-view-paywall-save>Save to My Queue</a>
		</div>
	</div>`;
}

function articleWith(inner: string): string {
	return `<article class="view__body" data-article-body>${inner}</article>`;
}

function makeDocument(bodyHtml: string): Document {
	return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`).window
		.document;
}

function setArticleHeight(doc: Document, value: number): void {
	const el = doc.querySelector<HTMLElement>("[data-article-body]");
	assert(el, "[data-article-body] must exist in fixture");
	Object.defineProperty(el, "offsetHeight", { value, configurable: true });
}

function paywallEl(doc: Document): Element {
	const el = doc.querySelector("[data-view-paywall]");
	assert(el, "paywall element must exist in fixture");
	return el;
}

/** A scroll-aware window stub: `scrollTo` moves the position and fires the
 * registered listener, and `hasListener` lets a test assert the latch detached
 * it. Kept separate from jsdom so detachment is directly observable. */
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
			removeEventListener(_type: "scroll", _l: () => void): void {
				listener = null;
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

function createClock(startMs: number) {
	let now = startMs;
	const timers = new Map<number, { cb: () => void; fireAt: number }>();
	let nextId = 1;
	return {
		now: (): number => now,
		setTimeoutFn: (cb: () => void, ms: number): unknown => {
			const id = nextId++;
			timers.set(id, { cb, fireAt: now + ms });
			return id;
		},
		clearTimeoutFn: (id: unknown): void => {
			if (typeof id === "number") timers.delete(id);
		},
		advance(ms: number): void {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.fireAt <= now) {
					timers.delete(id);
					timer.cb();
				}
			}
		},
		pending: (): number => timers.size,
	};
}

interface DispatchRecord {
	type: string;
	paywallActiveAttr: string | null;
}

function start(
	doc: Document,
	fake: ReturnType<typeof createFakeWindow>,
	clock: ReturnType<typeof createClock>,
): DispatchRecord[] {
	const dispatched: DispatchRecord[] = [];
	initViewPaywall({
		document: doc,
		window: fake.win,
		now: clock.now,
		setTimeoutFn: clock.setTimeoutFn,
		clearTimeoutFn: clock.clearTimeoutFn,
		dispatchDocumentEvent: (type) => {
			dispatched.push({
				type,
				paywallActiveAttr: paywallEl(doc).getAttribute("data-paywall-active"),
			});
		},
	});
	return dispatched;
}

describe("initViewPaywall — gating no-ops", () => {
	it("is a no-op when no [data-view-paywall] element is present", () => {
		const doc = makeDocument(articleWith(""));
		const fake = createFakeWindow();
		const clock = createClock(START_MS);

		start(doc, fake, clock);

		assert.equal(fake.hasListener(), false);
		assert.equal(clock.pending(), 0);
	});

	it("is a no-op when the paywall carries no data-expires-at", () => {
		const doc = makeDocument(articleWith(paywallMarkup("")));
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		assert.equal(fake.hasListener(), false);
		assert.equal(clock.pending(), 0);
		assert.equal(paywallEl(doc).classList.contains(ACTIVE), false);
	});

	it("is a no-op when data-expires-at is not a parseable timestamp", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="not-a-date"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		assert.equal(fake.hasListener(), false);
		assert.equal(clock.pending(), 0);
		assert.equal(paywallEl(doc).classList.contains(ACTIVE), false);
	});

	it("is a no-op when the article body element is absent", () => {
		const doc = makeDocument(paywallMarkup(` data-expires-at="${EXPIRED_ISO}"`));
		const fake = createFakeWindow();
		const clock = createClock(START_MS);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		assert.equal(fake.hasListener(), false);
		assert.equal(clock.pending(), 0);
		assert.equal(paywallEl(doc).classList.contains(ACTIVE), false);
	});
});

describe("initViewPaywall — scroll + expiry gates", () => {
	it("does not blur on load and stays hidden while within 10% of the article top", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${EXPIRED_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		assert.equal(paywallEl(doc).classList.contains(INACTIVE), true);

		fake.scrollTo(99); // threshold is 100px

		const el = paywallEl(doc);
		assert.equal(el.classList.contains(ACTIVE), false);
		assert.equal(el.classList.contains(INACTIVE), true);
		assert.equal(el.getAttribute("data-paywall-active"), "false");
	});

	it("does not reveal once scrolled past 10% while access has not expired", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${COUNTING_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		const el = paywallEl(doc);
		assert.equal(el.classList.contains(ACTIVE), false);
		assert.equal(el.classList.contains(INACTIVE), true);
		assert.equal(clock.pending(), 1); // the deadline timer is still armed
	});

	it("reveals when an expired reader scrolls past 10%", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${EXPIRED_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		const el = paywallEl(doc);
		assert.equal(el.classList.contains(ACTIVE), true);
		assert.equal(el.classList.contains(INACTIVE), false);
		assert.equal(el.getAttribute("data-paywall-active"), "true");
		assert.equal(clock.pending(), 0); // no timer armed for an already-expired page
	});

	it("reveals a scrolled-past reader the instant a counting page's deadline passes", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${COUNTING_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);
		assert.equal(paywallEl(doc).classList.contains(ACTIVE), false); // not yet expired

		clock.advance(5000); // deadline reached → timer fires

		const el = paywallEl(doc);
		assert.equal(el.classList.contains(ACTIVE), true);
		assert.equal(el.getAttribute("data-paywall-active"), "true");
		assert.equal(clock.pending(), 0);
	});

	it("reveals after the deadline timer fires and the reader then scrolls past 10%", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${COUNTING_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		clock.advance(5000); // timer fires while the reader has not scrolled
		assert.equal(paywallEl(doc).classList.contains(ACTIVE), false);

		fake.scrollTo(PAST_THRESHOLD);

		const el = paywallEl(doc);
		assert.equal(el.classList.contains(ACTIVE), true);
		assert.equal(el.getAttribute("data-paywall-active"), "true");
	});
});

describe("initViewPaywall — latch", () => {
	it("detaches the scroll listener, clears the timer, and stays revealed after the reveal", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${COUNTING_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);
		clock.advance(5000); // reveal via the deadline timer

		const el = paywallEl(doc);
		assert.equal(el.classList.contains(ACTIVE), true);
		assert.equal(fake.hasListener(), false); // listener detached
		assert.equal(clock.pending(), 0); // timer cleared

		fake.scrollTo(0); // scrolling back up must not un-blur
		assert.equal(el.classList.contains(ACTIVE), true);
		assert.equal(el.classList.contains(INACTIVE), false);
	});
});

describe("initViewPaywall — reveal announcement", () => {
	it("announces the reveal once, with the latched state already applied", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${EXPIRED_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		const dispatched = start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		assert.deepEqual(dispatched, [
			{ type: PAYWALL_REVEALED_EVENT, paywallActiveAttr: "true" },
		]);
	});

	it("does not announce again on later scrolls", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${COUNTING_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		const dispatched = start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);
		clock.advance(5000); // reveal via the deadline timer
		fake.scrollTo(PAST_THRESHOLD + 100);

		assert.equal(dispatched.length, 1);
	});

	it("stays silent while access has not expired", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${COUNTING_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		const dispatched = start(doc, fake, clock);
		fake.scrollTo(PAST_THRESHOLD);

		assert.deepEqual(dispatched, []);
	});

	it("stays silent on an expired page the reader has not scrolled", () => {
		const doc = makeDocument(
			articleWith(paywallMarkup(` data-expires-at="${EXPIRED_ISO}"`)),
		);
		const fake = createFakeWindow();
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);

		const dispatched = start(doc, fake, clock);
		clock.advance(5000);

		assert.deepEqual(dispatched, []);
	});
});

describe("initViewPaywall — share balloon suppression", () => {
	const OPEN_CLASS = "share-balloon__wrap--open";
	const SHARE_DISMISSED_KEY = "readplace.share-dismissed";

	function balloonMarkup(): string {
		return `<span data-share-balloon-status></span>
		<div data-share-balloon-wrap hidden>
			<div data-share-balloon-buttons>
				<button type="button" data-share-balloon-copy data-share-url="https://example.com/x?utm_medium=copy"></button>
				<button type="button" data-share-balloon data-share-url="https://example.com/x?utm_medium=share" data-share-title="Hello"></button>
			</div>
			<button type="button" data-share-balloon-close></button>
			<span data-share-balloon-copied></span>
		</div>`;
	}

	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("closes an open bubble when the wall reveals mid-read, without dismissing it", () => {
		const dom = new JSDOM(
			`<!doctype html><html><body>${balloonMarkup()}${articleWith(
				paywallMarkup(` data-expires-at="${COUNTING_ISO}"`),
			)}</body></html>`,
			{ url: "https://readplace.com/" },
		);
		const { window } = dom;
		const doc = window.document;
		const clock = createClock(START_MS);
		setArticleHeight(doc, ARTICLE_HEIGHT);
		Object.defineProperty(window, "scrollY", {
			value: 0,
			writable: true,
			configurable: true,
		});

		initShareBalloon({
			window,
			document: doc,
			storage: window.localStorage,
			navigator: { share: () => Promise.resolve() },
			setTimeoutFn: setTimeout,
			clearTimeoutFn: clearTimeout,
		}).attach();
		initViewPaywall({
			document: doc,
			window,
			now: clock.now,
			setTimeoutFn: clock.setTimeoutFn,
			clearTimeoutFn: clock.clearTimeoutFn,
			dispatchDocumentEvent: (type) =>
				doc.dispatchEvent(new window.Event(type)),
		});

		Object.defineProperty(window, "scrollY", { value: 600 }); // past both thresholds
		window.dispatchEvent(new window.Event("scroll"));
		jest.advanceTimersByTime(1000);

		const wrap = doc.querySelector("[data-share-balloon-wrap]");
		assert(wrap, "the balloon wrap must exist in the fixture");
		assert.equal(wrap.classList.contains(OPEN_CLASS), true); // open before the wall

		clock.advance(5000); // deadline passes → wall latches

		assert.equal(paywallEl(doc).classList.contains(ACTIVE), true);
		assert.equal(wrap.classList.contains(OPEN_CLASS), false);
		assert.equal(wrap.hasAttribute("hidden"), false); // pill stays available
		assert.equal(window.localStorage.getItem(SHARE_DISMISSED_KEY), null);
	});
});
