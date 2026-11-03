import { ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	buildInboxEmailDetailUrl,
	parseInboxEmailFilter,
	parseMailTab,
} from "./inbox-email-detail.url";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ENCODED_EMAIL_ID = "2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const WORK = ReadlistSlugSchema.parse("work");

describe("parseMailTab", () => {
	it("reads the Articles tab from the query", () => {
		expect(parseMailTab("articles")).toBe("articles");
	});

	it("reads the Skipped tab from the query", () => {
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
			`/inbox/${ENCODED_EMAIL_ID}`,
		);
	});

	it("addresses the Articles tab with a tab param", () => {
		expect(
			buildInboxEmailDetailUrl({ emailId: EMAIL_ID, tab: "articles" }),
		).toBe(`/inbox/${ENCODED_EMAIL_ID}?tab=articles`);
	});

	it("addresses the Skipped tab with a tab param", () => {
		expect(
			buildInboxEmailDetailUrl({ emailId: EMAIL_ID, tab: "excluded" }),
		).toBe(`/inbox/${ENCODED_EMAIL_ID}?tab=excluded`);
	});

	it("writes the readlist filter after the tab and page size", () => {
		expect(
			buildInboxEmailDetailUrl({
				emailId: EMAIL_ID,
				tab: "articles",
				shown: 40,
				filter: { readlist: WORK, show: "rest" },
			}),
		).toBe(
			`/inbox/${ENCODED_EMAIL_ID}?tab=articles&shown=40&readlist=work&show=rest`,
		);
	});
});

describe("parseInboxEmailFilter", () => {
	it("reads a filter written by the detail URL", () => {
		const url = new URL(
			buildInboxEmailDetailUrl({
				emailId: EMAIL_ID,
				tab: "articles",
				filter: { readlist: WORK, show: "fit" },
			}),
			"https://inbox.test",
		);

		expect(parseInboxEmailFilter(Object.fromEntries(url.searchParams))).toEqual(
			{
				readlist: WORK,
				show: "fit",
			},
		);
	});

	it("ignores a readlist without a show", () => {
		expect(parseInboxEmailFilter({ readlist: "work" })).toBeUndefined();
	});

	it("ignores a show without a readlist", () => {
		expect(parseInboxEmailFilter({ show: "rest" })).toBeUndefined();
	});

	it("ignores a show that is neither fit nor rest", () => {
		expect(
			parseInboxEmailFilter({ readlist: "work", show: "all" }),
		).toBeUndefined();
	});

	it("ignores a readlist that is not a slug", () => {
		expect(
			parseInboxEmailFilter({ readlist: "Not A Slug", show: "fit" }),
		).toBeUndefined();
	});

	it("ignores a query that is not an object", () => {
		expect(parseInboxEmailFilter(undefined)).toBeUndefined();
	});
});
