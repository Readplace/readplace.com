import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { GlobalNav } from "./nav.component";
import type { TrialDisplay } from "./trial-countdown.format";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

/** Inside the inbox NEW badge's one-week window, so badge-agnostic tests render
 * the same nav they always did. Pinned rather than `new Date()` so no test here
 * starts failing once the badge lapses. */
const BADGE_ACTIVE = new Date("2026-07-21T00:00:00.000Z");
const BADGE_LAPSED = new Date("2026-07-27T00:00:00.000Z");

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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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

	it("renders the Inbox entry for every full-access user, with no feature flag to opt in", () => {
		const doc = parse(GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, now: BADGE_ACTIVE }));

		const libraryItems = Array.from(
			doc
				.querySelector('[data-test-nav-group="library"]')
				?.querySelectorAll("[data-test-nav-item]") ?? [],
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(libraryItems).toEqual(["queue", "import", "inbox"]);
	});

	it("submits the Inbox entry as a plain GET form carrying no feature flag", () => {
		const doc = parse(GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, now: BADGE_ACTIVE }));

		const inboxForm = doc.querySelector('[data-test-nav-item="inbox"]')?.closest("form");
		assert(inboxForm, "inbox nav item must be inside a form");
		expect(inboxForm.getAttribute("method")).toBe("GET");
		expect(inboxForm.querySelector('input[type="hidden"][name="feature"]')).toBeNull();
	});

	it("pins a NEW badge to the Inbox icon and to no other entry", () => {
		const doc = parse(GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, now: BADGE_ACTIVE }));

		const badges = Array.from(doc.querySelectorAll("[data-test-nav-badge]"));
		expect(badges.map((el) => el.textContent)).toEqual(["NEW"]);

		const inbox = doc.querySelector('[data-test-nav-item="inbox"]');
		assert(inbox, "inbox nav item must render");
		const badge = inbox.querySelector("[data-test-nav-badge]");
		assert(badge, "the NEW badge must sit inside the inbox entry");
		// Anchored to the icon wrapper, not the button: the badge is positioned
		// against the glyph, so a badge outside that wrapper would float free.
		assert(badge.closest(".nav__icon-wrap"), "the badge must be anchored to the icon wrapper");
	});

	it("drops the NEW badge once the week is up, keeping the Inbox entry itself", () => {
		const doc = parse(GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, now: BADGE_LAPSED }));

		expect(doc.querySelector("[data-test-nav-badge]")).toBeNull();
		assert(doc.querySelector('[data-test-nav-item="inbox"]'), "the inbox entry outlives its badge");
	});

	it("carries no dismiss control on the badge, so a reader cannot clear it early", () => {
		const doc = parse(GlobalNav({ variant: "default", isAuthenticated: true, accessIsReadOnly: false, now: BADGE_ACTIVE }));

		const badge = doc.querySelector("[data-test-nav-badge]");
		assert(badge, "the NEW badge must render inside its window");
		expect(badge.querySelector("button, a, input, form")).toBeNull();
		const inboxForm = doc.querySelector('[data-test-nav-item="inbox"]')?.closest("form");
		assert(inboxForm, "inbox nav item must be inside a form");
		expect(inboxForm.querySelector('input[name="dismiss"], [data-dismiss]')).toBeNull();
	});

	it("keeps the icon out of each item's accessible name, leaving the label alone", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
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
				now: BADGE_ACTIVE,
			}),
		);

		const header = doc.querySelector(".header");
		assert(header, "header element must render");
		expect(header.classList.contains("header--transparent")).toBe(true);
	});
});
