import {
	initComprehensiveParserDepBundle,
	initParserDepBundle,
} from "./parser";

describe("initParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
			logInfo: () => {},
		});

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.crawlArticle).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
		expect(typeof bundle.isSiteRuleUrl).toBe("function");
	});
});

describe("initComprehensiveParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initComprehensiveParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
		});

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.crawlArticle).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
		expect(typeof bundle.isSiteRuleUrl).toBe("function");
	});
});
