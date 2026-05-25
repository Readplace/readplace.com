import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Nav } from "./nav.component";
import type { TrialDisplay } from "./trial-countdown.format";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

const ACTIVE_TRIAL: TrialDisplay = {
	state: "active",
	endsAtIso: "2026-01-15T00:00:00.000Z",
	serverNowIso: "2026-01-01T00:00:00.000Z",
	remaining: { days: 13, hours: 12, minutes: 33, seconds: 22, totalMs: 1 },
	escalation: "moderate",
};

describe("Nav component", () => {
	it("omits the trial countdown when trialCounter is undefined", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				showSubscription: false,
				accessIsReadOnly: false,
			}),
		);

		expect(doc.querySelector("[data-test-trial-countdown]")).toBeNull();
	});

	it("renders the trial countdown with active state, escalation class, and data attributes", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				showSubscription: false,
				accessIsReadOnly: false,
				trialCounter: ACTIVE_TRIAL,
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be present for an active trial");
		expect(countdown.textContent).toBe("13d 12h left in your free trial");
		expect(countdown.classList.contains("trial-countdown--moderate")).toBe(true);
		expect(countdown.getAttribute("data-trial-state")).toBe("active");
		expect(countdown.getAttribute("data-trial-ends-at-iso")).toBe("2026-01-15T00:00:00.000Z");
		expect(countdown.getAttribute("data-server-now-iso")).toBe("2026-01-01T00:00:00.000Z");
		expect(countdown.getAttribute("role")).toBe("timer");
	});

	it("renders the expired pill for an expired trial without active-trial data attributes", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				showSubscription: false,
				accessIsReadOnly: false,
				trialCounter: { state: "expired" },
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be present for an expired trial");
		expect(countdown.textContent).toBe("Subscription not active");
		expect(countdown.classList.contains("trial-countdown--expired")).toBe(true);
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
		expect(countdown.getAttribute("data-trial-ends-at-iso")).toBe("");
		expect(countdown.getAttribute("data-server-now-iso")).toBe("");
	});

	it("renders authenticated nav items (queue, import, export, sign out) for an authenticated user", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				showSubscription: false,
				accessIsReadOnly: false,
			}),
		);

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
		assert(doc.querySelector('[data-test-nav-item="queue"]'));
		assert(doc.querySelector('[data-test-nav-item="import"]'));
		assert(doc.querySelector('[data-test-nav-item="export"]'));
		assert(doc.querySelector('[data-test-nav-item="logout"]'));
		expect(doc.querySelector('[data-test-nav-item="account"]')).toBeNull();
	});

	it("renders the account nav item only when showSubscription is true", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				showSubscription: true,
				accessIsReadOnly: false,
			}),
		);

		const account = doc.querySelector('[data-test-nav-item="account"]');
		assert(account, "account nav item must render when showSubscription is true");
		const form = account.closest("form");
		assert(form, "account nav item must be inside a form");
		expect(form.getAttribute("action")).toBe("/account?feature=subscription");
	});

	it("renders guest nav items (features, signup) for an unauthenticated user", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: false,
				showSubscription: false,
				accessIsReadOnly: false,
			}),
		);

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");
		assert(doc.querySelector('[data-test-nav-item="features"]'));
		assert(doc.querySelector('[data-test-nav-item="signup"]'));
		expect(doc.querySelector('[data-test-nav-item="queue"]')).toBeNull();
	});

	it("applies the transparent header modifier when variant is 'transparent'", () => {
		const doc = parse(
			Nav({
				variant: "transparent",
				isAuthenticated: false,
				showSubscription: false,
				accessIsReadOnly: false,
			}),
		);

		const header = doc.querySelector(".header");
		assert(header, "header element must render");
		expect(header.classList.contains("header--transparent")).toBe(true);
	});
});
