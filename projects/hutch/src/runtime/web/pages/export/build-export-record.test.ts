import { MinutesSchema, ReaderArticleHashId, type SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import { toExportArticle } from "./build-export-record";

function makeArticle(url: string): SavedArticle {
	return {
		id: ReaderArticleHashId.from(url),
		userId: UserIdSchema.parse("test-user-id"),
		url,
		destinationUrl: destinationUrl(url),
		metadata: { title: "T", siteName: siteLabel("S"), excerpt: "E", wordCount: 1200 },
		servedBody: { kind: "legacy" },
		estimatedReadTime: MinutesSchema.parse(6),
		status: "unread",
		savedAt: new Date("2026-09-30T01:02:03.000Z"),
	};
}

describe("toExportArticle", () => {
	it("exports the read time of an article", () => {
		expect(toExportArticle(makeArticle("https://example.com/post")).readTime).toEqual({ value: "6", label: "6 min read" });
	});

	it("exports no read time for a YouTube video", () => {
		expect(toExportArticle(makeArticle("https://www.youtube.com/watch?v=J3PGI4yqta4")).readTime).toBeNull();
	});
});
