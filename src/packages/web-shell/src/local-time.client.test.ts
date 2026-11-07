import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initLocalTime } from "./local-time.client";

const SYDNEY = "Australia/Sydney";

type TickStorage = () => { getItem(key: string): string | null };

function initWithDom(
	bodyHtml: string,
	options: { timeZone?: string; now?: () => Date; storage?: TickStorage } = {},
): {
	document: Document;
	triggerSwap: () => void;
	tick: () => void;
	tickIntervals: number[];
} {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
	let swapListener: (() => void) | undefined;
	let tickListener: (() => void) | undefined;
	const tickIntervals: number[] = [];
	initLocalTime({
		document: dom.window.document,
		timeZone: () => options.timeZone ?? SYDNEY,
		addSwapListener: (listener) => {
			swapListener = listener;
		},
		now: options.now ?? (() => new Date("2026-06-24T09:00:00.000Z")),
		every: (ms, listener) => {
			tickIntervals.push(ms);
			tickListener = listener;
		},
		storage: options.storage ?? (() => ({ getItem: () => null })),
	}).attach();
	return {
		document: dom.window.document,
		triggerSwap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
		tick: () => {
			assert(tickListener, "a tick listener must be registered");
			tickListener();
		},
		tickIntervals,
	};
}

describe("initLocalTime", () => {
	it("rewrites a datetime element into the browser zone with the abbreviation", () => {
		const { document } = initWithDom(
			`<time datetime="2026-06-24T09:00:00.000Z" data-local-time="datetime">Jun 24, 2026, 09:00 UTC</time>`,
		);
		expect(document.querySelector("time")?.textContent).toBe(
			"Jun 24, 2026, 19:00 GMT+10",
		);
	});

	it("rewrites a time element into the browser zone on the 12-hour clock", () => {
		const { document } = initWithDom(
			`<time datetime="2026-03-26T14:32:00.000Z" data-local-time="time">02:32 PM</time>`,
		);
		expect(document.querySelector("time")?.textContent).toBe("01:32 AM");
	});

	it("rewrites a date element into the browser zone, fixing midnight ±1-day drift", () => {
		const { document } = initWithDom(
			`<time datetime="2026-06-23T15:00:00.000Z" data-local-time="date">Jun 23, 2026</time>`,
		);
		expect(document.querySelector("time")?.textContent).toBe("Jun 24, 2026");
	});

	it("leaves relative text in place and only sets the localised absolute instant as a title", () => {
		const { document } = initWithDom(
			`<time datetime="2026-06-24T09:00:00.000Z" data-local-time="relative">5m ago</time>`,
		);
		const el = document.querySelector("time");
		assert(el, "time element must render");
		expect(el.textContent).toBe("5m ago");
		expect(el.getAttribute("title")).toBe("Jun 24, 2026, 19:00 GMT+10");
	});

	it("leaves a calendar date that carries no data-local-time as the server wrote it", () => {
		const { document } = initWithDom(
			`<time datetime="2025-10-08">Oct 8, 2025</time>`,
			{ timeZone: "America/Los_Angeles" },
		);
		const el = document.querySelector("time");
		assert(el, "time element must render");
		expect([el.textContent, el.getAttribute("title")]).toEqual(["Oct 8, 2025", null]);
	});

	it("skips an element with a missing or unparseable datetime", () => {
		const { document } = initWithDom(
			`<time data-local-time="datetime">no datetime</time><time datetime="not-a-date" data-local-time="datetime">bad</time>`,
		);
		const [missing, unparseable] = Array.from(document.querySelectorAll("time"));
		expect(missing.textContent).toBe("no datetime");
		expect(unparseable.textContent).toBe("bad");
	});

	it("re-localises elements inserted after an htmx swap", () => {
		const { document, triggerSwap } = initWithDom("");
		document.body.innerHTML = `<time datetime="2026-06-24T09:00:00.000Z" data-local-time="datetime">Jun 24, 2026, 09:00 UTC</time>`;
		triggerSwap();
		expect(document.querySelector("time")?.textContent).toBe(
			"Jun 24, 2026, 19:00 GMT+10",
		);
	});

	it("rewrites a ticking saved time against the clock once a minute", () => {
		let now = new Date("2026-06-24T09:05:30.000Z");
		const { document, tick, tickIntervals } = initWithDom(
			`<time datetime="2026-06-24T09:00:00.000Z" data-local-time="relative" data-local-time-tick>just now</time>`,
			{ now: () => now },
		);
		const el = document.querySelector("time");
		assert(el, "time element must render");
		tick();
		const afterFirstTick = el.textContent;
		now = new Date("2026-06-24T11:00:00.000Z");
		tick();
		expect([tickIntervals, afterFirstTick, el.textContent]).toEqual([[60_000], "5m ago", "2h ago"]);
	});

	it("leaves a relative time without the tick attribute as the server wrote it", () => {
		const { document, tick } = initWithDom(
			`<time datetime="2026-06-24T09:00:00.000Z" data-local-time="relative">5 minutes ago</time>`,
			{ now: () => new Date("2026-06-24T10:00:00.000Z") },
		);
		tick();
		expect(document.querySelector("time")?.textContent).toBe("5 minutes ago");
	});

	it("turns a ticking time past the 30-day cutoff into the date in the viewer's zone", () => {
		const { document, tick } = initWithDom(
			`<time datetime="2026-05-24T15:00:00.000Z" data-local-time="relative" data-local-time-tick>29d ago</time>`,
			{ now: () => new Date("2026-06-24T15:00:00.000Z") },
		);
		const el = document.querySelector("time");
		assert(el, "time element must render");
		tick();
		expect([el.getAttribute("data-local-time"), el.textContent]).toEqual(["date", "May 25, 2026"]);
	});

	it("leaves a ticking time whose datetime does not parse as the server wrote it", () => {
		const { document, tick } = initWithDom(
			`<time datetime="not-a-date" data-local-time="relative" data-local-time-tick>3m ago</time>`,
		);
		tick();
		expect(document.querySelector("time")?.textContent).toBe("3m ago");
	});

	it("schedules no tick once the reader's storage carries the tick opt-out", () => {
		const { tickIntervals } = initWithDom("", {
			storage: () => ({
				getItem: (key) => (key === "readplace:local-time-tick-off" ? "1" : null),
			}),
		});
		expect(tickIntervals).toEqual([]);
	});

	it("still schedules the tick when the browser refuses access to storage", () => {
		const { tickIntervals } = initWithDom("", {
			storage: () => {
				throw new Error("SecurityError");
			},
		});
		expect(tickIntervals).toEqual([60_000]);
	});

	it("still schedules the tick when reading the opt-out from storage throws", () => {
		const { tickIntervals } = initWithDom("", {
			storage: () => ({
				getItem: () => {
					throw new Error("SecurityError");
				},
			}),
		});
		expect(tickIntervals).toEqual([60_000]);
	});
});
