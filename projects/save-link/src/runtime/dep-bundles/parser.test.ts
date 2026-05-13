import { initParserDepBundle } from "./parser";

describe("initParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initParserDepBundle({ logError: () => {} });

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.crawlArticle).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
	});
});
