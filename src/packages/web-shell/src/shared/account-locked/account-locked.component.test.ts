import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { AccountLockedPage } from "./account-locked.component";

function documentOf(logoutTrackSource: string): Document {
	const page = AccountLockedPage({ logoutTrackSource });
	return new JSDOM(page.content.html).window.document;
}

describe("AccountLockedPage", () => {
	it("refuses with 403 and keeps the locked page out of search", () => {
		const page = AccountLockedPage({ logoutTrackSource: "account-locked" });
		expect(page.statusCode).toBe(403);
		expect(page.bodyClass).toBe("page-account-locked");
		expect(page.seo.title).toBe("Account locked — Readplace");
		expect(page.seo.robots).toBe("noindex, nofollow");
	});

	it("tells the reader the account is locked and who to email", () => {
		const doc = documentOf("account-locked");
		expect(doc.querySelector("h1")?.textContent).toBe("Your account is locked");
		expect(doc.querySelector(".account-locked__lede")?.textContent).toBe(
			"Your email was never verified within 7 days of signing up, so your account is locked. Email readplace+verification@readplace.com and I'll restore your access.",
		);
		expect(doc.querySelector(".account-locked__link")?.getAttribute("href")).toBe(
			"mailto:readplace+verification@readplace.com",
		);
	});

	it.each(["account-locked", "inbox-account-locked"])("tracks the sign-out escape hatch under %s", (source) => {
		const logout = documentOf(source).querySelector("form");
		assert(logout, "the locked page must keep a logout form");
		expect(logout.getAttribute("action")).toBe(`/logout?utm_source=${source}&utm_medium=internal&utm_content=logout`);
		expect(logout.getAttribute("method")).toBe("POST");
		expect(logout.querySelector("button")?.textContent).toBe("Sign out");
	});
});
