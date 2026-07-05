import {
	buildInboxEmailsUrl,
	canonicalInboxEmailsPageRedirect,
	parseInboxEmailsUrl,
} from "./inbox-emails.url";

describe("parseInboxEmailsUrl", () => {
	it("defaults to page 1 for an empty query", () => {
		expect(parseInboxEmailsUrl({})).toEqual({ page: 1 });
	});

	it("parses a valid page number", () => {
		expect(parseInboxEmailsUrl({ page: "3" }).page).toBe(3);
	});

	it("defaults to page 1 for junk values", () => {
		expect(parseInboxEmailsUrl({ page: "abc" }).page).toBe(1);
		expect(parseInboxEmailsUrl({ page: "0" }).page).toBe(1);
		expect(parseInboxEmailsUrl({ page: "-1" }).page).toBe(1);
		expect(parseInboxEmailsUrl({ page: "1.5" }).page).toBe(1);
	});
});

describe("buildInboxEmailsUrl", () => {
	it("always carries the email feature flag", () => {
		expect(buildInboxEmailsUrl({})).toBe("/inbox?feature=email");
	});

	it("omits page 1", () => {
		expect(buildInboxEmailsUrl({ page: 1 })).toBe("/inbox?feature=email");
	});

	it("appends page > 1 after the flag", () => {
		expect(buildInboxEmailsUrl({ page: 2 })).toBe("/inbox?feature=email&page=2");
	});
});

describe("canonicalInboxEmailsPageRedirect", () => {
	it("returns undefined for an in-bounds page", () => {
		expect(
			canonicalInboxEmailsPageRedirect({ page: 1, total: 20, pageSize: 20 }),
		).toBeUndefined();
	});

	it("returns undefined for the last valid page", () => {
		expect(
			canonicalInboxEmailsPageRedirect({ page: 3, total: 60, pageSize: 20 }),
		).toBeUndefined();
	});

	it("clamps a page beyond the last to the last valid page", () => {
		expect(
			canonicalInboxEmailsPageRedirect({ page: 4, total: 60, pageSize: 20 }),
		).toBe("/inbox?feature=email&page=3");
	});

	it("clamps a page beyond an empty inbox to page 1", () => {
		expect(
			canonicalInboxEmailsPageRedirect({ page: 2, total: 0, pageSize: 20 }),
		).toBe("/inbox?feature=email");
	});
});
