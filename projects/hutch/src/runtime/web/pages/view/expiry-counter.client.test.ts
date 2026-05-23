import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	decomposeTimeLeftClient,
	formatCounterText,
	formatSaveUtmContentClient,
	initExpiryCounter,
	withSaveUtmContent,
} from "./expiry-counter.client";

const FIXED_NOW = new Date("2026-05-20T00:00:00.000Z").getTime();

function buildDoc(html: string): { document: Document; window: Window } {
	const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
	return {
		document: dom.window.document,
		window: dom.window as unknown as Window,
	};
}

interface FakeInterval {
	id: number;
	tick(): void;
}

function buildFakeInterval(): {
	setIntervalFn: (cb: () => void, ms: number) => unknown;
	clearIntervalFn: (id: unknown) => void;
	intervals: FakeInterval[];
} {
	const intervals: FakeInterval[] = [];
	return {
		setIntervalFn(cb) {
			const id = intervals.length + 1;
			intervals.push({ id, tick: cb });
			return id;
		},
		clearIntervalFn(id) {
			const idx = intervals.findIndex((i) => i.id === id);
			if (idx >= 0) intervals.splice(idx, 1);
		},
		intervals,
	};
}

describe("decomposeTimeLeftClient", () => {
	it("splits a duration into d/h/m/s using the same algorithm as the server helper", () => {
		expect(decomposeTimeLeftClient(((24 + 2) * 3600 + 30) * 1000)).toEqual({
			days: 1,
			hours: 2,
			minutes: 0,
			seconds: 30,
		});
	});

	it("clamps non-positive values to zero so the counter degrades to `0d 0h 0m 0s`", () => {
		expect(decomposeTimeLeftClient(-1)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
	});
});

describe("formatCounterText", () => {
	it("matches the SSR copy so the first client tick does not replace the server text with a different format", () => {
		expect(
			formatCounterText({ days: 1, hours: 2, minutes: 3, seconds: 4 }),
		).toBe("Public access will expire in 1d 2h 3m 4s");
	});
});

describe("formatSaveUtmContentClient", () => {
	it("matches the SSR utm_content so click-time and load-time analytics rows share the same value when no second has elapsed", () => {
		expect(
			formatSaveUtmContentClient({ days: 2, hours: 4, minutes: 5, seconds: 6 }),
		).toBe("2d_4h_left");
	});
});

describe("withSaveUtmContent", () => {
	it("rewrites utm_content on a relative href while preserving other params and the path", () => {
		expect(
			withSaveUtmContent("/save?url=x&utm_content=2d_4h_left&foo=bar", "1d_5h_left"),
		).toBe("/save?url=x&utm_content=1d_5h_left&foo=bar");
	});

	it("preserves the absolute origin when the href is fully qualified", () => {
		expect(
			withSaveUtmContent("https://readplace.com/save?utm_content=old", "0d_3h_left"),
		).toBe("https://readplace.com/save?utm_content=0d_3h_left");
	});

	it("adds utm_content when none was present in the original href", () => {
		expect(withSaveUtmContent("/save?url=x", "1d_5h_left")).toBe(
			"/save?url=x&utm_content=1d_5h_left",
		);
	});
});

describe("initExpiryCounter", () => {
	it("returns undefined when no expiry element exists (e.g. the landing page)", () => {
		const { document } = buildDoc("");
		const fake = buildFakeInterval();

		const controller = initExpiryCounter({
			document,
			now: () => FIXED_NOW,
			...fake,
		});

		expect(controller).toBeUndefined();
		expect(fake.intervals.length).toBe(0);
	});

	it("returns undefined when state='permanent' so the script becomes a no-op", () => {
		const { document } = buildDoc(
			`<p data-test-view-expiry data-expiry-state="permanent">Public access doesn't expire.</p>`,
		);
		const fake = buildFakeInterval();

		const controller = initExpiryCounter({
			document,
			now: () => FIXED_NOW,
			...fake,
		});

		expect(controller).toBeUndefined();
		expect(fake.intervals.length).toBe(0);
	});

	it("ticks the visible counter text and updates [data-expiry-save-link] anchors' utm_content on each interval", () => {
		const expiresAt = new Date(FIXED_NOW + 90_000);
		const { document } = buildDoc(`
			<a data-expiry-save-link data-test-view-cta-action href="/save?url=x&utm_content=0d_0h_left">Save</a>
			<p
				data-test-view-expiry
				data-expiry-state="counting"
				data-expires-at="${expiresAt.toISOString()}"
			>Public access will expire in 0d 0h 1m 30s</p>
		`);
		const fake = buildFakeInterval();
		let nowMs = FIXED_NOW;

		const controller = initExpiryCounter({
			document,
			now: () => nowMs,
			...fake,
		});
		assert(controller, "controller should be returned when counter is active");

		const expiry = document.querySelector("[data-test-view-expiry]");
		assert(expiry, "expiry element must exist");
		expect(expiry.textContent).toContain("0d 0h 1m 30s");

		nowMs += 60_000;
		fake.intervals[0]?.tick();

		expect(expiry.textContent).toContain("0d 0h 0m 30s");
		const saveLink = document.querySelector("[data-expiry-save-link]");
		assert(saveLink, "save link must exist");
		const updatedHref = saveLink.getAttribute("href");
		assert(updatedHref, "href must be set");
		const updated = new URL(updatedHref, "http://placeholder.invalid");
		expect(updated.searchParams.get("utm_content")).toBe("0d_0h_left");
	});

	it("flips state to 'expired' and stops ticking once the deadline passes so the interval doesn't keep firing forever", () => {
		const expiresAt = new Date(FIXED_NOW + 1_000);
		const { document } = buildDoc(
			`<p data-test-view-expiry data-expiry-state="counting" data-expires-at="${expiresAt.toISOString()}">Public access will expire in 0d 0h 0m 1s</p>`,
		);
		const fake = buildFakeInterval();
		let nowMs = FIXED_NOW;

		const controller = initExpiryCounter({
			document,
			now: () => nowMs,
			...fake,
		});
		assert(controller, "controller should be returned");

		nowMs += 2_000;
		fake.intervals[0]?.tick();

		const expiry = document.querySelector("[data-test-view-expiry]");
		assert(expiry, "expiry element must exist");
		expect(expiry.getAttribute("data-expiry-state")).toBe("expired");
		expect(expiry.textContent?.trim()).toBe("Public access has expired.");
		expect(fake.intervals.length).toBe(0);
	});

	it("returns undefined when data-expires-at is missing so a malformed render does not throw", () => {
		const { document } = buildDoc(
			`<p data-test-view-expiry data-expiry-state="counting">Public access will expire in 0d 0h 1m 30s</p>`,
		);
		const fake = buildFakeInterval();

		const controller = initExpiryCounter({
			document,
			now: () => FIXED_NOW,
			...fake,
		});

		expect(controller).toBeUndefined();
	});

	it("returns undefined when data-expires-at is not a parseable ISO string", () => {
		const { document } = buildDoc(
			`<p data-test-view-expiry data-expiry-state="counting" data-expires-at="not-a-date">x</p>`,
		);
		const fake = buildFakeInterval();

		const controller = initExpiryCounter({
			document,
			now: () => FIXED_NOW,
			...fake,
		});

		expect(controller).toBeUndefined();
	});

	it("stop() detaches the interval so callers can clean up without leaks", () => {
		const expiresAt = new Date(FIXED_NOW + 60_000);
		const { document } = buildDoc(
			`<p data-test-view-expiry data-expiry-state="counting" data-expires-at="${expiresAt.toISOString()}">x</p>`,
		);
		const fake = buildFakeInterval();

		const controller = initExpiryCounter({
			document,
			now: () => FIXED_NOW,
			...fake,
		});
		assert(controller, "controller should be returned");
		expect(fake.intervals.length).toBe(1);

		controller.stop();
		expect(fake.intervals.length).toBe(0);
	});
});
