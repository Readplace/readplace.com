import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	decomposeTimeLeft as packageDecomposeTimeLeft,
	formatCounter as packageFormatCounter,
} from "@packages/time-left";
import {
	decomposeTimeLeft,
	formatCountingMessage,
	formatCounter,
	formatSaveUtmContent,
	initExpiryCounter,
	withSaveUtmContent,
} from "./expiry-counter.client";
import { formatSaveUtmContent as serverFormatSaveUtmContent } from "./view-expiry";

function makeDoc(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function counterHtml(expiresAt: string): string {
	return `<aside class="view__cta">
		<div class="view__cta-content">
			<a class="view__cta-btn view__cta-btn--primary" href="/save?url=https%3A%2F%2Fexample.com%2Fpost&utm_content=2d_10h_left" data-expiry-save-link>Save to My Queue</a>
		</div>
		<p class="view__expiry view__expiry--counting" data-expiry-state="counting" data-expires-at="${expiresAt}">Public access will expire in 2d 10h 5m 33s</p>
	</aside>`;
}

interface FakeTimers {
	now: number;
	advance(ms: number): void;
	pending(): Array<{ id: number; cb: () => void; interval: number; nextAt: number }>;
}

function createFakeTimers(initialNowMs: number) {
	const timers: Array<{ id: number; cb: () => void; interval: number; nextAt: number }> = [];
	let nextId = 1;
	const state: FakeTimers = {
		now: initialNowMs,
		advance(ms: number) {
			state.now += ms;
			while (true) {
				const due = timers.find((t) => t.nextAt <= state.now);
				if (due === undefined) return;
				due.nextAt += due.interval;
				due.cb();
			}
		},
		pending() {
			return [...timers];
		},
	};
	const setIntervalFn = (cb: () => void, interval: number) => {
		const id = nextId++;
		timers.push({ id, cb, interval, nextAt: state.now + interval });
		return id;
	};
	const clearIntervalFn = (id: unknown) => {
		const idx = timers.findIndex((t) => t.id === id);
		if (idx !== -1) timers.splice(idx, 1);
	};
	return { state, setIntervalFn, clearIntervalFn };
}

describe("decomposeTimeLeft (client mirror)", () => {
	it("matches the server's decomposeTimeLeft output for a representative input", () => {
		const ms = 2 * 86_400_000 + 10 * 3_600_000 + 5 * 60_000 + 33_000;
		assert.deepStrictEqual(decomposeTimeLeft(ms), packageDecomposeTimeLeft(ms));
	});

	it("returns all zeros for zero input", () => {
		assert.deepStrictEqual(decomposeTimeLeft(0), packageDecomposeTimeLeft(0));
	});

	it("returns all zeros for negative input (matches server)", () => {
		assert.deepStrictEqual(decomposeTimeLeft(-1000), packageDecomposeTimeLeft(-1000));
	});
});

describe("formatCounter (client mirror)", () => {
	it("matches the server's formatCounter for a representative input", () => {
		const tl = { days: 1, hours: 10, minutes: 5, seconds: 33 };
		assert.equal(formatCounter(tl), packageFormatCounter(tl));
	});

	it("matches the server for seconds-only output", () => {
		const tl = { days: 0, hours: 0, minutes: 0, seconds: 5 };
		assert.equal(formatCounter(tl), packageFormatCounter(tl));
	});
});

describe("formatSaveUtmContent (client mirror)", () => {
	it("matches the server's formatSaveUtmContent output", () => {
		const tl = { days: 2, hours: 4, minutes: 30, seconds: 15 };
		assert.equal(formatSaveUtmContent(tl), serverFormatSaveUtmContent(tl));
	});

	it("matches the server for a fresh-save value", () => {
		const tl = { days: 3, hours: 0, minutes: 0, seconds: 0 };
		assert.equal(formatSaveUtmContent(tl), serverFormatSaveUtmContent(tl));
	});
});

describe("formatCountingMessage", () => {
	it("renders the SSR text format for an arbitrary ms value", () => {
		const ms = 2 * 86_400_000 + 10 * 3_600_000 + 5 * 60_000 + 33_000;
		assert.equal(formatCountingMessage(ms), "Public access will expire in 2d 10h 5m 33s");
	});
});

describe("withSaveUtmContent", () => {
	it("replaces utm_content on an absolute href", () => {
		const next = withSaveUtmContent(
			"https://readplace.com/save?url=x&utm_content=2d_10h_left",
			"1d_22h_left",
		);
		const url = new URL(next);
		assert.equal(url.searchParams.get("utm_content"), "1d_22h_left");
		assert.equal(url.searchParams.get("url"), "x");
	});

	it("preserves the path-relative form for /save hrefs", () => {
		const next = withSaveUtmContent("/save?url=x&utm_content=2d_10h_left", "1d_22h_left");
		assert(next.startsWith("/save?"), `expected path-relative href, got ${next}`);
		const url = new URL(next, "https://readplace.com");
		assert.equal(url.searchParams.get("utm_content"), "1d_22h_left");
	});

	it("adds utm_content when the original href has none", () => {
		const next = withSaveUtmContent("/save?url=x", "1d_22h_left");
		const url = new URL(next, "https://readplace.com");
		assert.equal(url.searchParams.get("utm_content"), "1d_22h_left");
	});
});

describe("initExpiryCounter", () => {
	it("is a no-op when no [data-expiry-state='counting'] element is present", () => {
		const doc = makeDoc(`<p data-expiry-state="permanent" data-test-view-expiry></p>`);
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(Date.now());
		const controller = initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});
		assert.equal(state.pending().length, 0);
		controller.stop();
	});

	it("is a no-op when [data-expires-at] is missing", () => {
		const doc = makeDoc(
			`<p data-expiry-state="counting" data-test-view-expiry></p>`,
		);
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(Date.now());
		initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});
		assert.equal(state.pending().length, 0);
	});

	it("is a no-op when [data-expires-at] is not a parseable timestamp", () => {
		const doc = makeDoc(
			`<p data-expiry-state="counting" data-expires-at="not-a-date"></p>`,
		);
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(Date.now());
		initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});
		assert.equal(state.pending().length, 0);
	});

	it("updates the counter text on each tick", () => {
		const startMs = Date.parse("2026-05-01T00:00:00.000Z");
		const expiresAt = "2026-05-03T10:05:33.000Z";
		const doc = makeDoc(counterHtml(expiresAt));
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(startMs);
		initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});

		state.advance(1000);

		const counter = doc.querySelector("[data-expiry-state]");
		assert(counter, "counter must remain in the DOM");
		assert.equal(
			counter.textContent,
			"Public access will expire in 2d 10h 5m 32s",
		);
	});

	it("re-stamps utm_content on [data-expiry-save-link] anchors on each tick at day/hour resolution", () => {
		const startMs = Date.parse("2026-05-01T00:00:00.000Z");
		const expiresAt = "2026-05-03T10:05:33.000Z";
		const doc = makeDoc(counterHtml(expiresAt));
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(startMs);
		initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});

		state.advance(2 * 60 * 60 * 1000);

		const link = doc.querySelector("[data-expiry-save-link]");
		assert(link, "save link must be rendered");
		const url = new URL(link.getAttribute("href") ?? "", "https://readplace.com");
		assert.equal(url.searchParams.get("utm_content"), "2d_8h_left");
	});

	it("flips data-expiry-state to 'expired', updates the message, and stops the interval when the deadline passes", () => {
		const startMs = Date.parse("2026-05-01T00:00:00.000Z");
		const expiresAt = "2026-05-01T00:00:05.000Z";
		const doc = makeDoc(counterHtml(expiresAt));
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(startMs);
		initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});

		state.advance(6 * 1000);

		const counter = doc.querySelector("[data-test-view-expiry], [data-expiry-state]");
		assert(counter, "counter must remain in the DOM");
		assert.equal(counter.getAttribute("data-expiry-state"), "expired");
		assert.equal(counter.textContent, "Public access has expired.");
		assert.equal(counter.classList.contains("view__expiry--expired"), true);
		assert.equal(counter.classList.contains("view__expiry--counting"), false);
		assert.equal(state.pending().length, 0);
	});

	it("stop() clears the interval and prevents further ticks from mutating the DOM", () => {
		const startMs = Date.parse("2026-05-01T00:00:00.000Z");
		const expiresAt = "2026-05-03T10:05:33.000Z";
		const doc = makeDoc(counterHtml(expiresAt));
		const { state, setIntervalFn, clearIntervalFn } = createFakeTimers(startMs);
		const controller = initExpiryCounter({
			document: doc,
			now: () => state.now,
			setIntervalFn,
			clearIntervalFn,
		});

		controller.stop();
		assert.equal(state.pending().length, 0);

		state.advance(10 * 1000);

		const counter = doc.querySelector("[data-expiry-state]");
		assert(counter, "counter must remain in the DOM");
		assert.equal(
			counter.textContent,
			"Public access will expire in 2d 10h 5m 33s",
		);
	});
});
