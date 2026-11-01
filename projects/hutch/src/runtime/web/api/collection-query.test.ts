import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { buildQueryString } from "./collection-query";

describe("buildQueryString", () => {
	it("names the addressed readlist ahead of the filters so one readlist's hrefs share a prefix", () => {
		expect(
			buildQueryString({
				readlistKey: "readlist",
				readlist: ReadlistSlugSchema.parse("work"),
				status: "read",
				order: "asc",
				page: 2,
			}),
		).toEqual("?readlist=work&status=read&order=asc&page=2");
	});

	it("names the readlist under the retired queue key when the caller serves a client that still matches hrefs by it", () => {
		expect(buildQueryString({ readlistKey: "queue", readlist: ReadlistSlugSchema.parse("work"), status: "read" })).toEqual(
			"?queue=work&status=read",
		);
	});

	it("names no readlist for the default one, so a shipped client keeps reading one representation of /queue", () => {
		expect(buildQueryString({ readlistKey: "readlist", readlist: DEFAULT_READLIST_SLUG, status: "unread" })).toEqual(
			"?status=unread",
		);
	});

	it("builds an empty string when nothing is set, so a bare collection href stays bare", () => {
		expect(buildQueryString({ readlistKey: "readlist" })).toEqual("");
	});
});
