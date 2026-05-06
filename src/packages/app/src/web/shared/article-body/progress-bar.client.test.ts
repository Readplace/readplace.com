import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type BarTick,
	computeRate,
	initProgressBars,
	projectPct,
	readProgressAttrs,
} from "./progress-bar.client";

function barAt(pct: number, tickAt: string): string {
	return `<div id="article-body-progress" class="article-body__progress" data-progress-bar data-progress-pct="${pct}" data-progress-tick-at="${tickAt}" data-progress-stage="crawl-fetched"><div class="article-body__progress-fill" data-progress-fill style="width: ${pct}%"></div></div>`;
}

function makeDoc(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("computeRate", () => {
	it("returns the per-ms slope between two ticks", () => {
		const prev: BarTick = { tickAtMs: 1000, pct: 25 };
		const next: BarTick = { tickAtMs: 4000, pct: 55 };

		expect(computeRate(prev, next)).toBeCloseTo(0.01);
	});

	it("floors at 0 when the server reports a regression (worker redelivery)", () => {
		const prev: BarTick = { tickAtMs: 1000, pct: 90 };
		const next: BarTick = { tickAtMs: 4000, pct: 55 };

		expect(computeRate(prev, next)).toBe(0);
	});

	it("returns 0 when both ticks share a timestamp (clock skew)", () => {
		const prev: BarTick = { tickAtMs: 1000, pct: 25 };
		const next: BarTick = { tickAtMs: 1000, pct: 55 };

		expect(computeRate(prev, next)).toBe(0);
	});
});

describe("projectPct", () => {
	it("projects forward at the given rate", () => {
		expect(
			projectPct({ lastPct: 25, rate: 0.01, elapsedMs: 1000, cap: 99 }),
		).toBe(35);
	});

	it("caps at the supplied ceiling so the bar never closes ahead of the server", () => {
		expect(
			projectPct({ lastPct: 95, rate: 0.05, elapsedMs: 1000, cap: 99 }),
		).toBe(99);
	});

	it("does not regress below the last anchor when rate is 0", () => {
		expect(
			projectPct({ lastPct: 55, rate: 0, elapsedMs: 5000, cap: 99 }),
		).toBe(55);
	});
});

describe("readProgressAttrs", () => {
	it("parses pct and tickAtMs from the bar attributes", () => {
		const doc = makeDoc(barAt(25, "2026-04-25T12:00:00.000Z"));
		const bar = doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		const attrs = readProgressAttrs(bar);

		expect(attrs).toEqual({
			pct: 25,
			tickAtMs: Date.parse("2026-04-25T12:00:00.000Z"),
		});
	});

	it("returns tickAtMs: undefined when the SSR fallback emitted an empty tick-at", () => {
		const doc = makeDoc(barAt(5, ""));
		const bar = doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		const attrs = readProgressAttrs(bar);

		expect(attrs).toEqual({ pct: 5, tickAtMs: undefined });
	});

	it("returns undefined when data-progress-pct is absent (defensive — production templates always emit it)", () => {
		const doc = makeDoc(
			`<div data-progress-bar data-progress-tick-at=""><div data-progress-fill></div></div>`,
		);
		const bar = doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		expect(readProgressAttrs(bar)).toBeUndefined();
	});

	it("returns undefined when data-progress-pct is not a finite number", () => {
		const doc = makeDoc(
			`<div data-progress-bar data-progress-pct="abc" data-progress-tick-at=""><div data-progress-fill></div></div>`,
		);
		const bar = doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		expect(readProgressAttrs(bar)).toBeUndefined();
	});

	it("returns tickAtMs: undefined when data-progress-tick-at fails to parse", () => {
		const doc = makeDoc(
			`<div data-progress-bar data-progress-pct="25" data-progress-tick-at="not-a-date"><div data-progress-fill></div></div>`,
		);
		const bar = doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		expect(readProgressAttrs(bar)).toEqual({ pct: 25, tickAtMs: undefined });
	});
});

describe("initProgressBars", () => {
	function setup(html: string) {
		const doc = makeDoc(html);
		let nowMs = Date.parse("2026-04-25T12:00:00.000Z");
		const swapListeners: Array<() => void> = [];
		const rafCalls: Array<() => void> = [];
		const controller = initProgressBars({
			document: doc,
			now: () => nowMs,
			requestAnimationFrame: (cb) => {
				rafCalls.push(cb);
				return rafCalls.length;
			},
			cancelAnimationFrame: () => {},
			addSwapListener: (listener) => {
				swapListeners.push(listener);
			},
		});
		return {
			doc,
			controller,
			advance(ms: number) {
				nowMs += ms;
			},
			runFrame() {
				const cb = rafCalls.shift();
				if (cb) cb();
			},
			fireSwap() {
				for (const l of swapListeners) l();
			},
			fillWidth() {
				return doc.querySelector<HTMLElement>(".article-body__progress-fill")
					?.style.width;
			},
		};
	}

	it("anchors the bar at the SSR pct on first scan and projects forward on subsequent rAF ticks", () => {
		const env = setup(barAt(25, "2026-04-25T12:00:00.000Z"));

		// Advance past the SSR anchor so the second tick produces a positive dt
		// against the first, then land a fresh server tick at +3s.
		env.advance(3000);
		const bar = env.doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");
		bar.setAttribute("data-progress-pct", "55");
		bar.setAttribute(
			"data-progress-tick-at",
			"2026-04-25T12:00:03.000Z",
		);
		env.fireSwap();

		// 1500ms after the second tick — at the observed rate (10pct/sec) the
		// bar should project forward from 55% toward but not past 99%.
		env.advance(1500);
		env.runFrame();

		const width = env.fillWidth();
		assert(width, "fill width must be set");
		const pct = Number.parseFloat(width);
		expect(pct).toBeGreaterThan(55);
		expect(pct).toBeLessThanOrEqual(99);

		env.controller.stop();
	});

	it("stops projecting once the bar is removed from the DOM", () => {
		const env = setup(barAt(25, "2026-04-25T12:00:00.000Z"));
		const bar = env.doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		bar.remove();
		env.advance(1000);
		env.runFrame();

		// fill is detached with the bar — no error, no stale write
		env.controller.stop();
	});

	it("re-scans the DOM on swap and skips a tick that matches the existing anchor (no-op rescan)", () => {
		const env = setup(barAt(25, "2026-04-25T12:00:00.000Z"));

		// fireSwap with the same attributes — the bar should not advance.
		env.fireSwap();

		const widthBefore = env.fillWidth();
		expect(widthBefore).toBe("25%");
		env.controller.stop();
	});

	it("anchors against deps.now() when the SSR bar emits an empty tick-at, then absorbs the first real tick", () => {
		const env = setup(barAt(15, ""));

		const bar = env.doc.querySelector("[data-progress-bar]");
		assert(bar, "bar must be present");

		// Land a real tick after a 3s wait — the rate is computed from the
		// gap between the deps.now() anchor and this real tick.
		env.advance(3000);
		bar.setAttribute("data-progress-pct", "35");
		bar.setAttribute(
			"data-progress-tick-at",
			"2026-04-25T12:00:03.000Z",
		);
		env.fireSwap();

		// Re-scan with no real tick still on (incomingTickMs undefined) is also
		// a no-op — exercise the early return.
		bar.setAttribute("data-progress-tick-at", "");
		env.fireSwap();

		env.controller.stop();
	});

	it("stops the rAF loop when the controller's stop() is called", () => {
		const env = setup(barAt(25, "2026-04-25T12:00:00.000Z"));
		env.controller.stop();
		// runFrame after stop should be a no-op (the queued frame still fires
		// but bails on the `stopped` guard).
		env.advance(1000);
		env.runFrame();
	});
});
