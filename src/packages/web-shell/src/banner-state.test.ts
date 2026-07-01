import assert from "node:assert/strict";
import {
	bannerStateFromRequest,
	buildGuestNavItems,
	buildNavGroups,
} from "./banner-state";

/** The shell carries no domain dependency and reads `userId` only for
 * truthiness, so a plain string id is sufficient — there is no brand to parse. */
const USER_ID = "user-1";

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

	it("sets emailFeatureEnabled only when the query carries feature=email", () => {
		expect(bannerStateFromRequest({ query: { feature: "email" } }).emailFeatureEnabled).toBe(true);
		expect(bannerStateFromRequest({ query: { feature: "audio" } }).emailFeatureEnabled).toBe(false);
		expect(bannerStateFromRequest({}).emailFeatureEnabled).toBe(false);
	});
});

describe("buildGuestNavItems", () => {
	it("returns install, features, import, and signup as a flat list in that order", () => {
		const items = buildGuestNavItems();
		expect(items.map((i) => i.key)).toEqual(["install", "features", "import", "signup"]);
	});

	it("points the import item at the import page so logged-out visitors can start a migration", () => {
		const item = buildGuestNavItems().find((i) => i.key === "import");
		assert(item, "guest nav must include an import item");
		expect(item.href).toBe("/import?utm_source=header-nav&utm_medium=internal&utm_content=import");
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
	it("groups full-access items into Library (queue, import, export) and Account (account, sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, emailFeatureEnabled: false });
		expect(groups.map((g) => g.key)).toEqual(["library", "account"]);
		const [library, account] = groups;
		expect(library?.label).toBe("Library");
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "export"]);
		expect(account?.label).toBe("Account");
		expect(account?.items.map((i) => i.key)).toEqual(["account", "logout"]);
	});

	it("omits import and account for a read-only user, leaving Library (queue, export) and Account (sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true, emailFeatureEnabled: false });
		const [library, account] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "export"]);
		expect(account?.items.map((i) => i.key)).toEqual(["logout"]);
	});

	it("appends the Inbox entry to Library when the email feature is enabled", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, emailFeatureEnabled: true });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "export", "inbox"]);
	});

	it("omits the Inbox entry for a read-only user even when the email feature is enabled", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true, emailFeatureEnabled: true });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "export"]);
	});

	it("assigns a Font Awesome solid icon to every nav item", () => {
		const items = buildNavGroups({ accessIsReadOnly: false, emailFeatureEnabled: true }).flatMap(
			(g) => g.items,
		);
		for (const item of items) {
			expect(item.icon).toMatch(/^fa-solid fa-[a-z-]+$/);
		}
	});
});
