import assert from "node:assert/strict";
import { iconSvg } from "@packages/ui-icons";
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
				gmailFeatureEnabled: false,
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
				gmailFeatureEnabled: false,
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
				gmailFeatureEnabled: false,
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

	it("renders a quiet cancellation-scheduled chip (not the expired alarm) while the cutoff is more than 7 days away", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				trialCounter: {
					state: "cancellation-scheduled",
					endsAtIso: "2027-07-10T00:00:00.000Z",
					serverNowIso: "2026-07-10T00:00:00.000Z",
				},
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be present for a scheduled cancellation");
		expect(countdown.textContent).toBe("Ends Jul 10, 2027");
		expect(countdown.classList.contains("trial-countdown--cancellation-scheduled")).toBe(true);
		expect(countdown.classList.contains("trial-countdown--visible")).toBe(true);
		expect(countdown.classList.contains("trial-countdown--expired")).toBe(false);
		expect(countdown.getAttribute("data-trial-state")).toBe("cancellation-scheduled");
		expect(countdown.getAttribute("data-trial-ends-at-iso")).toBe("2027-07-10T00:00:00.000Z");
		expect(countdown.getAttribute("data-server-now-iso")).toBe("2026-07-10T00:00:00.000Z");
		expect(countdown.getAttribute("aria-label")).toBe("Subscription ends on Jul 10, 2027");
		expect(countdown.getAttribute("title")).toBe("Subscription ends on Jul 10, 2027");
	});

	it("escalates the cancellation chip to the imminent variant once the cutoff is 7 days away or closer", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				trialCounter: {
					state: "cancellation-scheduled",
					endsAtIso: "2026-07-17T00:00:00.000Z",
					serverNowIso: "2026-07-10T00:00:00.000Z",
				},
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be present for an imminent cancellation");
		expect(countdown.classList.contains("trial-countdown--cancellation-imminent")).toBe(true);
		expect(countdown.classList.contains("trial-countdown--cancellation-scheduled")).toBe(false);
		expect(countdown.getAttribute("data-trial-state")).toBe("cancellation-scheduled");
	});

	it("keeps the quiet cancellation chip just past the 7-day boundary so escalation flips only inside the final week", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				trialCounter: {
					state: "cancellation-scheduled",
					endsAtIso: "2026-07-17T00:00:00.001Z",
					serverNowIso: "2026-07-10T00:00:00.000Z",
				},
			}),
		);

		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must be present for a scheduled cancellation");
		expect(countdown.classList.contains("trial-countdown--cancellation-scheduled")).toBe(true);
	});

	it("omits aria-label and title for active and expired states so only the abbreviated chip carries an override", () => {
		const activeDoc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				trialCounter: ACTIVE_TRIAL,
			}),
		);
		const activeCountdown = activeDoc.querySelector("[data-test-trial-countdown]");
		assert(activeCountdown, "trial countdown must be present for an active trial");
		expect(activeCountdown.hasAttribute("aria-label")).toBe(false);
		expect(activeCountdown.hasAttribute("title")).toBe(false);

		const expiredDoc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				trialCounter: { state: "expired" },
			}),
		);
		const expiredCountdown = expiredDoc.querySelector("[data-test-trial-countdown]");
		assert(expiredCountdown, "trial countdown must be present for an expired trial");
		expect(expiredCountdown.hasAttribute("aria-label")).toBe(false);
		expect(expiredCountdown.hasAttribute("title")).toBe(false);
	});

	it("renders authenticated nav items (queue, import, inbox, account, sign out) for an authenticated full-access user", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
		assert(doc.querySelector('[data-test-nav-item="queue"]'));
		assert(doc.querySelector('[data-test-nav-item="import"]'));
		assert(doc.querySelector('[data-test-nav-item="inbox"]'));
		assert(doc.querySelector('[data-test-nav-item="logout"]'));
		const account = doc.querySelector('[data-test-nav-item="account"]');
		assert(account, "account nav item must render for authenticated full-access users");
		const form = account.closest("form");
		assert(form, "account nav item must be inside a form");
		expect(form.getAttribute("action")).toBe("/account?utm_source=header-nav&utm_medium=internal&utm_content=account");
	});

	it("splits the authenticated nav into a Library section (queue, import, inbox) and an Account section (account, sign out)", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
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
		expect(libraryItems).toEqual(["queue", "import", "inbox"]);

		const account = doc.querySelector('[data-test-nav-group="account"]');
		assert(account, "account group must render");
		expect(account.querySelector(".nav__group-label")?.textContent).toBe("Account");
		const accountItems = Array.from(
			account.querySelectorAll("[data-test-nav-item]"),
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(accountItems).toEqual(["account", "logout"]);
	});

	it("renders the Inbox entry for every full-access user", () => {
		const doc = parse(GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		}));

		const libraryItems = Array.from(
			doc
				.querySelector('[data-test-nav-group="library"]')
				?.querySelectorAll("[data-test-nav-item]") ?? [],
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(libraryItems).toEqual(["queue", "import", "inbox"]);
	});

	it("submits the Inbox entry as a plain GET form", () => {
		const doc = parse(GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		}));

		const inboxForm = doc.querySelector('[data-test-nav-item="inbox"]')?.closest("form");
		assert(inboxForm, "inbox nav item must be inside a form");
		expect(inboxForm.getAttribute("method")).toBe("GET");
		const hiddenInputNames = Array.from(
			inboxForm.querySelectorAll('input[type="hidden"]'),
		).map((el) => el.getAttribute("name"));
		expect(hiddenInputNames).toEqual(["utm_source", "utm_medium", "utm_content"]);
	});

	it("keeps the icon out of each item's accessible name, leaving the label alone", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const queue = doc.querySelector('[data-test-nav-item="queue"]');
		assert(queue, "queue nav item must render");
		expect(queue.textContent).toBe("Queue");
	});

	it("renders guest nav items (install, features, import, login) as a flat list without group structure, install left of features", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: false,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
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
				gmailFeatureEnabled: false,
			}),
		);

		const header = doc.querySelector(".header");
		assert(header, "header element must render");
		expect(header.classList.contains("header--transparent")).toBe(true);
	});

	it("renders the collapsed bars and the shared close cross together, so the open state alone flips the toggle", () => {
		const html = GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		});

		const toggle = parse(html).querySelector(".nav__toggle");
		assert(toggle, "nav toggle must render");
		expect(toggle.tagName.toLowerCase()).toBe("summary");
		expect(toggle.querySelectorAll(".nav__toggle-bar")).toHaveLength(3);
		expect(html).toContain(`<span class="nav__toggle-x">${iconSvg("x")}</span>`);
	});

	it("hangs the menu off a closed disclosure, so the bar opens it with no script", () => {
		const html = GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		});

		const disclosure = parse(html).querySelector(".nav__disclosure");
		assert(disclosure, "nav disclosure must render");
		expect(disclosure.hasAttribute("open")).toBe(false);
		expect(disclosure.querySelector("#nav-menu")?.className).toBe("nav__menu");
	});
});
