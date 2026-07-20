import assert from "node:assert/strict";
import {
	bannerStateFromRequest,
	inboxBadgeFor,
	buildGuestNavItems,
	buildNavGroups,
} from "./banner-state";

/** The shell carries no domain dependency and reads `userId` only for
 * truthiness, so a plain string id is sufficient — there is no brand to parse. */
const USER_ID = "user-1";

/** Inside the inbox NEW badge's one-week window. Pinned so nav-shape tests do
 * not change behaviour once the badge lapses. */
const BADGE_ACTIVE = new Date("2026-07-21T00:00:00.000Z");

describe("bannerStateFromRequest", () => {
	it("maps a present userId to isAuthenticated=true", () => {
		expect(bannerStateFromRequest({ userId: USER_ID })).toMatchObject({
			isAuthenticated: true,
		});
	});

	it("maps a missing userId to isAuthenticated=false", () => {
		expect(bannerStateFromRequest({})).toMatchObject({
			isAuthenticated: false,
		});
	});

	it("passes emailVerified through unchanged for true, false, and undefined", () => {
		expect(bannerStateFromRequest({ emailVerified: true }).emailVerified).toBe(true);
		expect(bannerStateFromRequest({ emailVerified: false }).emailVerified).toBe(false);
		expect(bannerStateFromRequest({}).emailVerified).toBeUndefined();
	});

	it("copies originalUrl to currentPath so the changelog dismiss form can post a return path", () => {
		expect(
			bannerStateFromRequest({ originalUrl: "/blog/x?utm_source=changelog-banner" }).currentPath,
		).toBe("/blog/x?utm_source=changelog-banner");
	});

	it("leaves currentPath undefined when the source carries no originalUrl", () => {
		expect(bannerStateFromRequest({}).currentPath).toBeUndefined();
	});

});

describe("buildGuestNavItems", () => {
	it("returns install, features, import, and login as a flat list in that order", () => {
		const items = buildGuestNavItems();
		expect(items.map((i) => i.key)).toEqual(["install", "features", "import", "login"]);
	});

	it("points the import item at the import page so logged-out visitors can start a migration", () => {
		const item = buildGuestNavItems().find((i) => i.key === "import");
		assert(item, "guest nav must include an import item");
		expect(item.href).toBe("/import?utm_source=header-nav&utm_medium=internal&utm_content=import");
	});

	it("points the login item at the login page", () => {
		const login = buildGuestNavItems().find((i) => i.key === "login");
		assert(login, "guest nav must include a login item");
		expect(login.href).toBe("/login?utm_source=header-nav&utm_medium=internal&utm_content=login");
	});

	it("points the install item at the install page", () => {
		const install = buildGuestNavItems().find((i) => i.key === "install");
		assert(install, "guest nav must include an install item");
		expect(install.href).toBe("/install?utm_source=header-nav&utm_medium=internal&utm_content=install");
	});

	it("assigns a Font Awesome solid icon to every guest item", () => {
		for (const item of buildGuestNavItems()) {
			expect(item.icon).toMatch(/^fa-solid fa-[a-z-]+$/);
		}
	});
});

describe("buildNavGroups", () => {
	it("groups full-access items into Library (queue, import, inbox) and Account (account, sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, now: BADGE_ACTIVE });
		expect(groups.map((g) => g.key)).toEqual(["library", "account"]);
		const [library, account] = groups;
		expect(library?.label).toBe("Library");
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "inbox"]);
		expect(account?.label).toBe("Account");
		expect(account?.items.map((i) => i.key)).toEqual(["account", "logout"]);
	});

	it("omits import, inbox, and account for a read-only user, leaving Library (queue) and Account (sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true, now: BADGE_ACTIVE });
		const [library, account] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue"]);
		expect(account?.items.map((i) => i.key)).toEqual(["logout"]);
	});

	it("keeps the Inbox entry in Library for every full-access user, with no feature flag to opt in", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, now: BADGE_ACTIVE });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toContain("inbox");
	});

	it("points the Inbox entry at the inbox page with no feature param", () => {
		const inbox = buildNavGroups({ accessIsReadOnly: false, now: BADGE_ACTIVE })
			.flatMap((g) => g.items)
			.find((i) => i.key === "inbox");
		assert(inbox, "library nav must include an inbox item");
		expect(inbox.href).toBe("/inbox?utm_source=header-nav&utm_medium=internal&utm_content=inbox");
	});

	it("assigns a Font Awesome solid icon to every nav item", () => {
		const items = buildNavGroups({ accessIsReadOnly: false, now: BADGE_ACTIVE }).flatMap((g) => g.items);
		for (const item of items) {
			expect(item.icon).toMatch(/^fa-solid fa-[a-z-]+$/);
		}
	});
});

describe("inboxBadgeFor", () => {
	it("announces the inbox for the week following its release", () => {
		expect(inboxBadgeFor(new Date("2026-07-20T00:00:00.000Z"))).toBe("NEW");
		expect(inboxBadgeFor(new Date("2026-07-26T23:59:59.999Z"))).toBe("NEW");
	});

	it("lapses exactly on the expiry instant rather than a moment either side", () => {
		expect(inboxBadgeFor(new Date("2026-07-27T00:00:00.000Z"))).toBeUndefined();
		expect(inboxBadgeFor(new Date("2026-07-26T23:59:59.999Z"))).toBe("NEW");
	});

	it("stays lapsed indefinitely, so the badge cannot resurface later", () => {
		expect(inboxBadgeFor(new Date("2027-01-01T00:00:00.000Z"))).toBeUndefined();
	});
});
