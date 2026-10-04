import assert from "node:assert/strict";
import { bannerStateFromRequest, buildGuestNavGroups, buildNavGroups } from "./banner-state";
import { generateCspNonce } from "./csp-nonce.middleware";

/** The shell carries no domain dependency and reads `userId` only for
 * truthiness, so a plain string id is sufficient — there is no brand to parse. */
const USER_ID = "user-1";

const CSP_NONCE = generateCspNonce();

describe("bannerStateFromRequest", () => {
	it("maps a present userId to isAuthenticated=true", () => {
		expect(bannerStateFromRequest({ userId: USER_ID, cspNonce: CSP_NONCE })).toMatchObject({
			isAuthenticated: true,
		});
	});

	it("maps a missing userId to isAuthenticated=false", () => {
		expect(bannerStateFromRequest({ cspNonce: CSP_NONCE })).toMatchObject({
			isAuthenticated: false,
		});
	});

	it("passes emailVerified through unchanged for true, false, and undefined", () => {
		expect(bannerStateFromRequest({ emailVerified: true, cspNonce: CSP_NONCE }).emailVerified).toBe(true);
		expect(bannerStateFromRequest({ emailVerified: false, cspNonce: CSP_NONCE }).emailVerified).toBe(false);
		expect(bannerStateFromRequest({ cspNonce: CSP_NONCE }).emailVerified).toBeUndefined();
	});

	it("carries per-request script markup through to the shell", () => {
		expect(bannerStateFromRequest({ requestScripts: "<script>x()</script>", cspNonce: CSP_NONCE }).requestScripts).toBe(
			"<script>x()</script>",
		);
	});

	it("leaves requestScripts undefined for a site that computes none", () => {
		expect(bannerStateFromRequest({ cspNonce: CSP_NONCE }).requestScripts).toBeUndefined();
	});

	it("copies originalUrl to currentPath so the changelog dismiss form can post a return path", () => {
		expect(
			bannerStateFromRequest({ originalUrl: "/blog/x?utm_source=changelog-banner", cspNonce: CSP_NONCE }).currentPath,
		).toBe("/blog/x?utm_source=changelog-banner");
	});

	it("leaves currentPath undefined when the source carries no originalUrl", () => {
		expect(bannerStateFromRequest({ cspNonce: CSP_NONCE }).currentPath).toBeUndefined();
	});

	it("carries the request's nonce onto the state the shell renders with", () => {
		expect(bannerStateFromRequest({ cspNonce: CSP_NONCE }).cspNonce).toBe(CSP_NONCE);
	});
});

describe("buildGuestNavGroups", () => {
	it("centres install, import, and features in Library and puts login alone in Account", () => {
		const groups = buildGuestNavGroups();
		expect(groups.map((g) => g.key)).toEqual(["library", "account"]);
		const [library, account] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["install", "import", "features"]);
		expect(account?.items.map((i) => i.key)).toEqual(["login"]);
	});

	it("points the import item at the import page so logged-out visitors can start a migration", () => {
		const item = buildGuestNavGroups()
			.flatMap((g) => g.items)
			.find((i) => i.key === "import");
		assert(item, "guest nav must include an import item");
		expect(item.href).toBe("/import?utm_source=header-nav&utm_medium=internal&utm_content=import");
	});

	it("points the login item at the login page", () => {
		const login = buildGuestNavGroups()
			.flatMap((g) => g.items)
			.find((i) => i.key === "login");
		assert(login, "guest nav must include a login item");
		expect(login.href).toBe("/login?utm_source=header-nav&utm_medium=internal&utm_content=login");
	});

	it("points the install item at the install page", () => {
		const install = buildGuestNavGroups()
			.flatMap((g) => g.items)
			.find((i) => i.key === "install");
		assert(install, "guest nav must include an install item");
		expect(install.href).toBe("/install?utm_source=header-nav&utm_medium=internal&utm_content=install");
	});

	it("styles login as the primary M button and every other guest item as a plain nav link", () => {
		const classes = buildGuestNavGroups()
			.flatMap((g) => g.items)
			.map((i) => [i.key, i.linkClass]);
		expect(classes).toEqual([
			["install", "nav__link"],
			["import", "nav__link"],
			["features", "nav__link"],
			["login", "nav__link btn btn--primary btn--m"],
		]);
	});
});

describe("buildNavGroups", () => {
	it("groups full-access items into Library (queue, import, inbox, integrations) and Account (account, blog, privacy, terms, sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false });
		expect(groups.map((g) => g.key)).toEqual(["library", "account"]);
		const [library, account] = groups;
		expect(library?.label).toBe("Library");
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "inbox", "integrations"]);
		expect(account?.label).toBe("Account");
		expect(account?.items.map((i) => i.key)).toEqual(["account", "blog", "privacy", "terms", "logout"]);
	});

	it("omits import and inbox for a read-only user but keeps Account, the only path to /account now the header has no trial chip", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true });
		const [library, account] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "integrations"]);
		expect(account?.items.map((i) => i.key)).toEqual(["account", "blog", "privacy", "terms", "logout"]);
	});

	it("links the signed-in Blog item to the blog from the account menu", () => {
		const blog = buildNavGroups({ accessIsReadOnly: false })
			.flatMap((group) => group.items)
			.find((item) => item.key === "blog");
		assert(blog, "the account menu must include Blog");
		expect(blog.href).toBe("/blog?utm_source=header-nav&utm_medium=internal&utm_content=blog");
		expect(blog.iconName).toBe("note");
	});

	it("tags the Privacy and Terms entries as header-nav clicks, since signed-in pages render no footer to reach them", () => {
		const hrefs = buildNavGroups({ accessIsReadOnly: false })
			.flatMap((g) => g.items)
			.filter((i) => i.key === "privacy" || i.key === "terms")
			.map((i) => [i.key, i.method, i.href]);
		expect(hrefs).toEqual([
			["privacy", "GET", "/privacy?utm_source=header-nav&utm_medium=internal&utm_content=privacy"],
			["terms", "GET", "/terms?utm_source=header-nav&utm_medium=internal&utm_content=terms"],
		]);
	});

	it("styles every signed-in item as a plain nav link", () => {
		const classes = buildNavGroups({ accessIsReadOnly: false })
			.flatMap((g) => g.items)
			.map((i) => i.linkClass);
		expect(new Set(classes)).toEqual(new Set(["nav__link"]));
	});

	it("keeps the Inbox entry in Library for every full-access user", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toContain("inbox");
	});

	it("points the Inbox entry at the inbox page", () => {
		const inbox = buildNavGroups({ accessIsReadOnly: false })
			.flatMap((g) => g.items)
			.find((i) => i.key === "inbox");
		assert(inbox, "library nav must include an inbox item");
		expect(inbox.href).toBe("/inbox?utm_source=header-nav&utm_medium=internal&utm_content=inbox");
	});

	it("shows the Integrations entry to a read-only user so they can stop forwarding", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toContain("integrations");
	});

	it("tags the Integrations href for internal-click tracking", () => {
		const integrations = buildNavGroups({ accessIsReadOnly: false })
			.flatMap((g) => g.items)
			.find((i) => i.key === "integrations");
		assert(integrations, "library nav must include an integrations item");
		expect(integrations.href).toBe(
			"/newsletters?utm_source=header-nav&utm_medium=internal&utm_content=integrations",
		);
		expect(integrations.label).toBe("Integrations");
	});
});

describe("header nav internal-click tagging across every access level", () => {
	const flagMatrix = [false, true].map((accessIsReadOnly) => ({ accessIsReadOnly }));
	const navs = flagMatrix.flatMap((flags) => [
		{ name: `guest ${JSON.stringify(flags)}`, groups: buildGuestNavGroups() },
		{ name: `authenticated ${JSON.stringify(flags)}`, groups: buildNavGroups(flags) },
	]);

	it.each(navs)("tags every $name item with source, internal medium and content on both the href and the hidden inputs", ({ groups }) => {
		for (const item of groups.flatMap((g) => g.items)) {
			const url = new URL(item.href, "https://readplace.com");
			expect([item.key, url.searchParams.get("utm_source")]).toEqual([item.key, "header-nav"]);
			expect([item.key, url.searchParams.get("utm_medium")]).toEqual([item.key, "internal"]);
			expect([item.key, url.searchParams.get("utm_content")]).toEqual([item.key, item.key]);
			expect([item.key, item.trackSource, item.trackContent]).toEqual([item.key, "header-nav", item.key]);
		}
	});

	it.each(navs)("gives every $name item a utm_content no other item in the nav shares", ({ groups }) => {
		const contents = groups
			.flatMap((g) => g.items)
			.map((item) => new URL(item.href, "https://readplace.com").searchParams.get("utm_content"));
		expect(new Set(contents).size).toBe(contents.length);
	});
});
