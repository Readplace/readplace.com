import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { buildQueryString } from "./collection-query";

describe("buildQueryString", () => {
	it("names the addressed readlist ahead of the filters so one readlist's hrefs share a prefix", () => {
		expect(
			buildQueryString({
				readlist: ReadlistSlugSchema.parse("work"),
				status: "read",
				order: "asc",
				page: 2,
			}),
		).toEqual("?queue=work&status=read&order=asc&page=2");
	});

	it("names no readlist for the default one, so a shipped client keeps reading one representation of /queue", () => {
		expect(buildQueryString({ readlist: DEFAULT_READLIST_SLUG, status: "unread" })).toEqual(
			"?status=unread",
		);
	});

	it("builds an empty string when nothing is set, so a bare collection href stays bare", () => {
		expect(buildQueryString({})).toEqual("");
	});
});
