import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { GlobalNav } from "./nav.component";
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

describe("GlobalNav component", () => {
	it("renders the trial countdown hidden (via state class) when trialCounter is undefined", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
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
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
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
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
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
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
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
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
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

	it("omits the Inbox entry by default and appends it after Export when the email feature is enabled", () => {
		const withoutFlag = Array.from(
			parse(
				GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, emailFeatureEnabled: false }),
			).querySelectorAll("[data-test-nav-item]"),
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(withoutFlag).not.toContain("inbox");

		const withFlag = parse(
			GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, emailFeatureEnabled: true }),
		);
		const libraryItems = Array.from(
			withFlag
				.querySelector('[data-test-nav-group="library"]')
				?.querySelectorAll("[data-test-nav-item]") ?? [],
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(libraryItems).toEqual(["queue", "import", "export", "inbox"]);
	});

	it("carries feature=email as a hidden input on the Inbox entry so its GET form keeps the gate flag", () => {
		const doc = parse(
			GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, emailFeatureEnabled: true }),
		);

		const inboxForm = doc.querySelector('[data-test-nav-item="inbox"]')?.closest("form");
		assert(inboxForm, "inbox nav item must be inside a form");
		expect(inboxForm.getAttribute("method")).toBe("GET");
		const feature = inboxForm.querySelector('input[type="hidden"][name="feature"]');
		assert(feature, "inbox form must carry the feature flag as a hidden input");
		expect(feature.getAttribute("value")).toBe("email");

		const queueForm = doc.querySelector('[data-test-nav-item="queue"]')?.closest("form");
		assert(queueForm, "queue nav item must be inside a form");
		expect(queueForm.querySelector('input[type="hidden"][name="feature"]')).toBeNull();
	});

	it("renders an aria-hidden Font Awesome icon alongside each label without polluting the accessible name", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
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

	it("renders guest nav items (install, features, import, login) as a flat list without group structure, install left of features", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: false,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
			}),
		);

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");

		const items = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
			(el) => el.getAttribute("data-test-nav-item"),
		);
		expect(items).toEqual(["install", "features", "import", "login"]);

		const install = doc.querySelector('[data-test-nav-item="install"]');
		assert(install, "guest nav must render an install item");
		expect(install.closest("form")?.getAttribute("action")).toBe("/install?utm_source=header-nav&utm_medium=internal&utm_content=install");
		expect(doc.querySelectorAll("[data-test-nav-group]")).toHaveLength(0);
	});

	it("applies the transparent header modifier when variant is 'transparent'", () => {
		const doc = parse(
			GlobalNav({
				variant: "transparent",
				isAuthenticated: false,
				accessIsReadOnly: false,
				emailFeatureEnabled: false,
			}),
		);

		const header = doc.querySelector(".header");
		assert(header, "header element must render");
		expect(header.classList.contains("header--transparent")).toBe(true);
	});
});
