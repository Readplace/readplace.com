import { buildInboxEmailDetailUrl, parseMailTab } from "./inbox-email-detail.url";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ENCODED_EMAIL_ID = "2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";

describe("parseMailTab", () => {
	it("reads the Articles tab from the query", () => {
		expect(parseMailTab("articles")).toBe("articles");
	});

	it("reads the Skipped Links tab from the query", () => {
		expect(parseMailTab("excluded")).toBe("excluded");
	});

	it("defaults to the View tab when no tab is requested", () => {
		expect(parseMailTab(undefined)).toBe("view");
	});

	it("falls back to the View tab for a tab that does not exist", () => {
		expect(parseMailTab("nope")).toBe("view");
		expect(parseMailTab(42)).toBe("view");
	});
});

describe("buildInboxEmailDetailUrl", () => {
	it("keeps the View tab on the canonical bare URL", () => {
		expect(buildInboxEmailDetailUrl({ emailId: EMAIL_ID, tab: "view" })).toBe(
			`/inbox/${ENCODED_EMAIL_ID}?feature=email`,
		);
	});

	it("addresses the Articles tab with a tab param", () => {
		expect(buildInboxEmailDetailUrl({ emailId: EMAIL_ID, tab: "articles" })).toBe(
			`/inbox/${ENCODED_EMAIL_ID}?feature=email&tab=articles`,
		);
	});

	it("addresses the Skipped Links tab with a tab param", () => {
		expect(buildInboxEmailDetailUrl({ emailId: EMAIL_ID, tab: "excluded" })).toBe(
			`/inbox/${ENCODED_EMAIL_ID}?feature=email&tab=excluded`,
		);
	});
});
