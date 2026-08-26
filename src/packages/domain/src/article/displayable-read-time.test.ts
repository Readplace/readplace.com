import { MinutesSchema } from "./article.schema";
import { displayableReadTime } from "./displayable-read-time";

const withWords = (wordCount: number, minutes: number) => ({
	metadata: { title: "t", siteName: "s", excerpt: "e", wordCount },
	estimatedReadTime: MinutesSchema.parse(minutes),
});

describe("displayableReadTime", () => {
	it("labels a crawled article with its rounded-up minutes", () => {
		expect(displayableReadTime(withWords(477, 3))).toEqual({
			value: "3",
			label: "~3 min read",
		});
	});

	it("is absent for an article whose crawl has not landed", () => {
		expect(displayableReadTime(withWords(0, 1))).toBeUndefined();
	});
});
