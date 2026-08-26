import assert from "node:assert/strict";
import { bannerStateFromRequest, buildGuestNavItems, buildNavGroups } from "./banner-state";
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
});

describe("buildNavGroups", () => {
	it("groups full-access items into Library (queue, import, inbox) and Account (account, sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, gmailFeatureEnabled: false });
		expect(groups.map((g) => g.key)).toEqual(["library", "account"]);
		const [library, account] = groups;
		expect(library?.label).toBe("Library");
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "inbox"]);
		expect(account?.label).toBe("Account");
		expect(account?.items.map((i) => i.key)).toEqual(["account", "logout"]);
	});

	it("omits import, inbox, and account for a read-only user, leaving Library (queue) and Account (sign out)", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true, gmailFeatureEnabled: false });
		const [library, account] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue"]);
		expect(account?.items.map((i) => i.key)).toEqual(["logout"]);
	});

	it("keeps the Inbox entry in Library for every full-access user", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, gmailFeatureEnabled: false });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toContain("inbox");
	});

	it("points the Inbox entry at the inbox page", () => {
		const inbox = buildNavGroups({ accessIsReadOnly: false, gmailFeatureEnabled: false })
			.flatMap((g) => g.items)
			.find((i) => i.key === "inbox");
		assert(inbox, "library nav must include an inbox item");
		expect(inbox.href).toBe("/inbox?utm_source=header-nav&utm_medium=internal&utm_content=inbox");
	});

	it("adds the Integrations entry to Library only for a request that opted into the feature", () => {
		const groups = buildNavGroups({ accessIsReadOnly: false, gmailFeatureEnabled: true });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue", "import", "inbox", "integrations"]);
	});

	it("keeps the Integrations entry hidden from a read-only user even with the feature on", () => {
		const groups = buildNavGroups({ accessIsReadOnly: true, gmailFeatureEnabled: true });
		const [library] = groups;
		expect(library?.items.map((i) => i.key)).toEqual(["queue"]);
	});

	it("carries the feature flag on the Integrations href so following it stays in the feature", () => {
		const integrations = buildNavGroups({ accessIsReadOnly: false, gmailFeatureEnabled: true })
			.flatMap((g) => g.items)
			.find((i) => i.key === "integrations");
		assert(integrations, "library nav must include an integrations item when the feature is on");
		expect(integrations.href).toBe(
			"/integrations?feature=gmail&utm_source=header-nav&utm_medium=internal&utm_content=integrations",
		);
	});
});

describe("bannerStateFromRequest feature toggle", () => {
	it("enables the Gmail feature when the request opted in with ?feature=gmail", () => {
		const state = bannerStateFromRequest({ query: { feature: "gmail" }, cspNonce: CSP_NONCE });
		expect(state.gmailFeatureEnabled).toBe(true);
	});

	it("leaves the Gmail feature off for another feature value", () => {
		const state = bannerStateFromRequest({ query: { feature: "something-else" }, cspNonce: CSP_NONCE });
		expect(state.gmailFeatureEnabled).toBe(false);
	});

	it("leaves the Gmail feature off for a source that carries no query at all", () => {
		const state = bannerStateFromRequest({ cspNonce: CSP_NONCE });
		expect(state.gmailFeatureEnabled).toBe(false);
	});
});
