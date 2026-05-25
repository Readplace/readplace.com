import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initTrialCountdown } from "./trial-countdown.client";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

interface FakeTimer {
	id: number;
	cb: () => void;
}

function buildFixture(opts: {
	endsAtIso: string;
	serverNowIso: string;
	state: "active" | "expired";
	escalation: string;
	text: string;
}): string {
	return `<!DOCTYPE html><html><body>
		<p class="trial-countdown trial-countdown--${opts.escalation}"
		   data-trial-ends-at-iso="${opts.endsAtIso}"
		   data-server-now-iso="${opts.serverNowIso}"
		   data-trial-state="${opts.state}"
		   role="timer"
		   aria-live="off"
		   data-test-trial-countdown>${opts.text}</p>
	</body></html>`;
}

function createDom(html: string) {
	const dom = new JSDOM(html, { url: "https://readplace.com/queue" });
	return { window: dom.window, document: dom.window.document };
}

interface FakeClock {
	now: number;
	timers: Map<number, FakeTimer>;
	nextId: number;
	deps: {
		document: Document;
		now: () => number;
		setIntervalFn: (cb: () => void, ms: number) => number;
		clearIntervalFn: (id: number) => void;
		addSwapListener: (cb: () => void) => void;
	};
	swapListener: (() => void) | undefined;
}

function createFakeClock(doc: Document, initialNowMs: number): FakeClock {
	const state: FakeClock = {
		now: initialNowMs,
		timers: new Map(),
		nextId: 1,
		swapListener: undefined,
		deps: {
			document: doc,
			now: () => state.now,
			setIntervalFn: (cb) => {
				const id = state.nextId++;
				state.timers.set(id, { id, cb });
				return id;
			},
			clearIntervalFn: (id) => {
				state.timers.delete(id);
			},
			addSwapListener: (cb) => {
				state.swapListener = cb;
			},
		},
	};
	return state;
}

function advanceClock(clock: FakeClock, ms: number): void {
	const ticksToFire = Math.floor(ms / ONE_SECOND_MS);
	for (let i = 0; i < ticksToFire; i += 1) {
		clock.now += ONE_SECOND_MS;
		for (const timer of Array.from(clock.timers.values())) {
			timer.cb();
		}
	}
	const remainder = ms - ticksToFire * ONE_SECOND_MS;
	clock.now += remainder;
}

function getCountdownElement(doc: Document): Element {
	const el = doc.querySelector("[data-test-trial-countdown]");
	assert(el, "trial countdown element must exist in fixture");
	return el;
}

describe("initTrialCountdown — tick updates the text every second using a clock-skew-corrected now", () => {
	it("rewrites the textContent every 1000ms with the new countdown string so the user sees the second-by-second tick when under a minute matters", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + 5 * ONE_MINUTE_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "critical",
				text: "placeholder",
			}),
		);

		const clientNow = Date.parse(serverNow);
		const clock = createFakeClock(document, clientNow);
		initTrialCountdown(clock.deps).attach();

		const el = getCountdownElement(document);
		expect(el.textContent).toBe("5m 0s left in your free trial");

		advanceClock(clock, ONE_SECOND_MS);
		expect(el.textContent).toBe("4m 59s left in your free trial");

		advanceClock(clock, ONE_SECOND_MS);
		expect(el.textContent).toBe("4m 58s left in your free trial");
	});

	it("corrects for client clock skew so a client clock that's 10 minutes ahead still produces the server-relative countdown", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + 5 * ONE_HOUR_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "urgent",
				text: "placeholder",
			}),
		);

		const skewedClientNow = Date.parse(serverNow) + 10 * ONE_MINUTE_MS;
		const clock = createFakeClock(document, skewedClientNow);
		initTrialCountdown(clock.deps).attach();

		expect(getCountdownElement(document).textContent).toBe(
			"5h 0m left in your free trial",
		);
	});
});

describe("initTrialCountdown — escalation class transitions as the deadline approaches", () => {
	it("swaps from --moderate to --urgent when crossing the one-day threshold during a tick", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + ONE_DAY_MS + 2 * ONE_SECOND_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "moderate",
				text: "placeholder",
			}),
		);

		const clock = createFakeClock(document, Date.parse(serverNow));
		initTrialCountdown(clock.deps).attach();

		const el = getCountdownElement(document);
		expect(el.classList.contains("trial-countdown--moderate")).toBe(true);
		expect(el.classList.contains("trial-countdown--urgent")).toBe(false);

		advanceClock(clock, 3 * ONE_SECOND_MS);

		expect(el.classList.contains("trial-countdown--moderate")).toBe(false);
		expect(el.classList.contains("trial-countdown--urgent")).toBe(true);
	});
});

describe("initTrialCountdown — expiration", () => {
	it("swaps the text to 'Subscription not active', sets data-trial-state=expired, aria-live=polite, and clears the interval", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + 2 * ONE_SECOND_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "critical",
				text: "placeholder",
			}),
		);

		const clock = createFakeClock(document, Date.parse(serverNow));
		initTrialCountdown(clock.deps).attach();

		expect(clock.timers.size).toBe(1);

		advanceClock(clock, 3 * ONE_SECOND_MS);

		const el = getCountdownElement(document);
		expect(el.textContent).toBe("Subscription not active");
		expect(el.getAttribute("data-trial-state")).toBe("expired");
		expect(el.getAttribute("aria-live")).toBe("polite");
		expect(el.classList.contains("trial-countdown--expired")).toBe(true);
		expect(clock.timers.size).toBe(0);
	});
});

describe("initTrialCountdown — visibility changes", () => {
	it("clears the interval when the document becomes hidden and re-arms it when it becomes visible again", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + ONE_HOUR_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "urgent",
				text: "placeholder",
			}),
		);

		const clock = createFakeClock(document, Date.parse(serverNow));
		initTrialCountdown(clock.deps).attach();

		expect(clock.timers.size).toBe(1);

		Object.defineProperty(document, "hidden", { configurable: true, value: true });
		document.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event("visibilitychange"));
		expect(clock.timers.size).toBe(0);

		Object.defineProperty(document, "hidden", { configurable: true, value: false });
		document.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event("visibilitychange"));
		expect(clock.timers.size).toBe(1);
	});
});

describe("initTrialCountdown — htmx swaps", () => {
	it("invokes the swap listener callback so a re-rendered header can be picked up on tick", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + ONE_HOUR_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "urgent",
				text: "placeholder",
			}),
		);

		const clock = createFakeClock(document, Date.parse(serverNow));
		initTrialCountdown(clock.deps).attach();
		assert(clock.swapListener, "swap listener must be registered");

		// Simulate an htmx swap that re-renders the countdown to a different remaining value
		const el = getCountdownElement(document);
		el.textContent = "stale text";

		clock.swapListener();

		expect(el.textContent).toBe("1h 0m left in your free trial");
	});
});

describe("initTrialCountdown — absent element", () => {
	it("returns a no-op controller when the page has no countdown element (guest pages)", () => {
		const { document } = createDom("<!DOCTYPE html><html><body></body></html>");
		const clock = createFakeClock(document, Date.now());

		const ctrl = initTrialCountdown(clock.deps);
		expect(() => ctrl.attach()).not.toThrow();
		expect(() => ctrl.stop()).not.toThrow();
		expect(clock.timers.size).toBe(0);
	});
});

describe("initTrialCountdown — already-expired initial state", () => {
	it("does not start the interval when data-trial-state='expired' is set in the SSR markup", () => {
		const { document } = createDom(
			buildFixture({
				endsAtIso: "2026-01-01T00:00:00.000Z",
				serverNowIso: "2026-01-02T00:00:00.000Z",
				state: "expired",
				escalation: "expired",
				text: "Subscription not active",
			}),
		);

		const clock = createFakeClock(document, Date.parse("2026-01-02T00:00:00.000Z"));
		initTrialCountdown(clock.deps).attach();

		expect(clock.timers.size).toBe(0);
		const el = getCountdownElement(document);
		expect(el.textContent).toBe("Subscription not active");
	});
});

describe("initTrialCountdown — clock skew fallback", () => {
	it("treats a missing data-server-now-iso attribute as skewMs=0 so the countdown still ticks against the client clock", () => {
		const endsAt = new Date(Date.parse("2026-01-01T00:00:00.000Z") + ONE_HOUR_MS).toISOString();
		const { document } = createDom(`<!DOCTYPE html><html><body>
			<p class="trial-countdown trial-countdown--urgent"
			   data-trial-ends-at-iso="${endsAt}"
			   data-server-now-iso=""
			   data-trial-state="active"
			   role="timer"
			   aria-live="off"
			   data-test-trial-countdown>placeholder</p>
		</body></html>`);

		const clock = createFakeClock(document, Date.parse("2026-01-01T00:00:00.000Z"));
		initTrialCountdown(clock.deps).attach();

		expect(getCountdownElement(document).textContent).toBe(
			"1h 0m left in your free trial",
		);
	});

	it("treats a non-parseable data-server-now-iso as skewMs=0", () => {
		const endsAt = new Date(Date.parse("2026-01-01T00:00:00.000Z") + 30 * ONE_MINUTE_MS).toISOString();
		const { document } = createDom(`<!DOCTYPE html><html><body>
			<p class="trial-countdown trial-countdown--urgent"
			   data-trial-ends-at-iso="${endsAt}"
			   data-server-now-iso="not-a-date"
			   data-trial-state="active"
			   role="timer"
			   aria-live="off"
			   data-test-trial-countdown>placeholder</p>
		</body></html>`);

		const clock = createFakeClock(document, Date.parse("2026-01-01T00:00:00.000Z"));
		initTrialCountdown(clock.deps).attach();

		expect(getCountdownElement(document).textContent).toBe(
			"30m 0s left in your free trial",
		);
	});
});

describe("initTrialCountdown — idempotent state transitions", () => {
	it("is a no-op when visibilitychange fires twice while the document stays hidden", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + ONE_HOUR_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "urgent",
				text: "placeholder",
			}),
		);

		const clock = createFakeClock(document, Date.parse(serverNow));
		initTrialCountdown(clock.deps).attach();
		expect(clock.timers.size).toBe(1);

		Object.defineProperty(document, "hidden", { configurable: true, value: true });
		document.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event("visibilitychange"));
		expect(clock.timers.size).toBe(0);

		// Second hidden event — interval already cleared, must stay 0
		document.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event("visibilitychange"));
		expect(clock.timers.size).toBe(0);
	});

	it("does not re-arm the interval when the trial has already expired and visibility flips back to visible", () => {
		const { document } = createDom(
			buildFixture({
				endsAtIso: "2026-01-01T00:00:00.000Z",
				serverNowIso: "2026-01-02T00:00:00.000Z",
				state: "expired",
				escalation: "expired",
				text: "Subscription not active",
			}),
		);

		const clock = createFakeClock(document, Date.parse("2026-01-02T00:00:00.000Z"));
		initTrialCountdown(clock.deps).attach();
		expect(clock.timers.size).toBe(0);

		Object.defineProperty(document, "hidden", { configurable: true, value: false });
		document.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event("visibilitychange"));

		expect(clock.timers.size).toBe(0);
	});
});

describe("initTrialCountdown — stop()", () => {
	it("removes the visibilitychange listener and clears the interval so the controller can be torn down for tests", () => {
		const serverNow = "2026-01-01T00:00:00.000Z";
		const endsAt = new Date(Date.parse(serverNow) + ONE_HOUR_MS).toISOString();
		const { document } = createDom(
			buildFixture({
				endsAtIso: endsAt,
				serverNowIso: serverNow,
				state: "active",
				escalation: "urgent",
				text: "placeholder",
			}),
		);

		const clock = createFakeClock(document, Date.parse(serverNow));
		const ctrl = initTrialCountdown(clock.deps);
		ctrl.attach();
		expect(clock.timers.size).toBe(1);

		ctrl.stop();
		expect(clock.timers.size).toBe(0);

		// After stop(), a visibilitychange event should not re-arm the interval.
		Object.defineProperty(document, "hidden", { configurable: true, value: false });
		document.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event("visibilitychange"));
		expect(clock.timers.size).toBe(0);
	});
});
