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
	it("renders the trial countdown hidden (via state class) when trialCounter is undefined", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown element must always be in the DOM");
		expect(countdown.classList.contains("trial-countdown--hidden")).toBe(true);
		expect(countdown.getAttribute("data-trial-state")).toBe("");
		expect(countdown.textContent).toBe("");
	});

	it("renders the trial countdown with active state, escalation class, and data attributes", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				trialCounter: ACTIVE_TRIAL,
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be present for an active trial");
		expect(countdown.textContent).toBe("13d 12h left in your free trial");
		expect(countdown.classList.contains("trial-countdown--moderate")).toBe(true);
		expect(countdown.classList.contains("trial-countdown--visible")).toBe(true);
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

	it("renders authenticated nav items (queue, import, export, account, sign out) for an authenticated full-access user", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
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
		const account = doc.querySelector('[data-test-nav-item="account"]');
		assert(account, "account nav item must render for authenticated full-access users");
		const form = account.closest("form");
		assert(form, "account nav item must be inside a form");
		expect(form.getAttribute("action")).toBe("/account?utm_source=header-nav&utm_medium=internal&utm_content=account");
	});

	it("splits the authenticated nav into a Library section (queue, import, export) and an Account section (account, sign out)", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
			}),
		);

		const groups = Array.from(doc.querySelectorAll("[data-test-nav-group]")).map(
			(el) => el.getAttribute("data-test-nav-group"),
		);
		expect(groups).toEqual(["library", "account"]);

		const library = doc.querySelector('[data-test-nav-group="library"]');
		assert(library, "library group must render");
		expect(library.querySelector(".nav__group-label")?.textContent).toBe("Library");
		const libraryItems = Array.from(
			library.querySelectorAll("[data-test-nav-item]"),
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(libraryItems).toEqual(["queue", "import", "export"]);

		const account = doc.querySelector('[data-test-nav-group="account"]');
		assert(account, "account group must render");
		expect(account.querySelector(".nav__group-label")?.textContent).toBe("Account");
		const accountItems = Array.from(
			account.querySelectorAll("[data-test-nav-item]"),
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(accountItems).toEqual(["account", "logout"]);
	});

	it("renders an aria-hidden Font Awesome icon alongside each label without polluting the accessible name", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
			}),
		);

		const queue = doc.querySelector('[data-test-nav-item="queue"]');
		assert(queue, "queue nav item must render");
		const icon = queue.querySelector(".nav__icon");
		assert(icon, "queue nav item must render an icon");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(icon.classList.contains("fa-inbox")).toBe(true);
		expect(queue.textContent).toBe("Queue");
	});

	it("renders guest nav items (install, features, signup) as a flat list without group structure, install left of features", () => {
		const doc = parse(
			Nav({
				variant: "default",
				isAuthenticated: false,
				accessIsReadOnly: false,
			}),
		);

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");

		const items = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
			(el) => el.getAttribute("data-test-nav-item"),
		);
		expect(items).toEqual(["install", "features", "signup"]);

		const install = doc.querySelector('[data-test-nav-item="install"]');
		assert(install, "guest nav must render an install item");
		expect(install.closest("form")?.getAttribute("action")).toBe("/install?utm_source=header-nav&utm_medium=internal&utm_content=install");
		expect(doc.querySelectorAll("[data-test-nav-group]")).toHaveLength(0);
	});

	it("applies the transparent header modifier when variant is 'transparent'", () => {
		const doc = parse(
			Nav({
				variant: "transparent",
				isAuthenticated: false,
				accessIsReadOnly: false,
			}),
		);

		const header = doc.querySelector(".header");
		assert(header, "header element must render");
		expect(header.classList.contains("header--transparent")).toBe(true);
	});
});
