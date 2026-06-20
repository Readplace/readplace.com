import assert from "node:assert/strict";
import {
	type BannerStateSource,
	bannerStateFromRequest,
	buildGuestNavItems,
	buildNavGroups,
} from "./banner-state";

/** The shell carries no @packages/domain dependency, so there is no UserId
 * schema to parse here. The truthiness of `userId` is all bannerStateFromRequest
 * reads, so a non-empty string narrowed through this predicate is a sufficient
 * branded fixture — mirroring the isChangelogVersion + assert narrowing used in
 * changelog-banner.test.ts, and avoiding an `as` cast to brand the value. */
function isUserId(value: string): value is NonNullable<BannerStateSource["userId"]> {
	return value.length > 0;
}

assert(isUserId("user-1"));
assert(!isUserId(""));

const USER_ID = "user-1";
assert(isUserId(USER_ID));

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
});

describe("buildGuestNavItems", () => {
	it("returns install, features, and signup as a flat list with install left of features", () => {
		const items = buildGuestNavItems();
		expect(items.map((i) => i.key)).toEqual(["install", "features", "signup"]);
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
		const groups = buildNavGroups({ accessIsReadOnly: false });
		expect(groups.map((g) => g.key)).toEqual(["library", "account"]);
		const [library, account] = groups;
		expect(library?.label).toBe("Library");
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "export"]);
		expect(account?.label).toBe("Account");
		expect(account?.items.map((i) => i.key)).toEqual(["account", "logout"]);
	});

	it("omits import and account for a read-only user, leaving Library (queue, export) and Account (sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true });
		const [library, account] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "export"]);
		expect(account?.items.map((i) => i.key)).toEqual(["logout"]);
	});

	it("assigns a Font Awesome solid icon to every nav item", () => {
		const items = buildNavGroups({ accessIsReadOnly: false }).flatMap((g) => g.items);
		for (const item of items) {
			expect(item.icon).toMatch(/^fa-solid fa-[a-z-]+$/);
		}
	});
});
