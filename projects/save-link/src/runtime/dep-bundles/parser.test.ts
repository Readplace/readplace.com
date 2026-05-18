import {
	initComprehensiveParserDepBundle,
	initParserDepBundle,
} from "./parser";

describe("initParserDepBundle", () => {
	it("returns a bundle with crawlFetch, simpleCrawl, and parseHtml fields (no comprehensive crawl)", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
		});

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.simpleCrawl).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
	});
});

describe("initComprehensiveParserDepBundle", () => {
	it("returns a bundle with crawlFetch, simpleCrawl, comprehensiveCrawl, and parseHtml fields", () => {
		const bundle = initComprehensiveParserDepBundle({
			logError: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
		});

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.simpleCrawl).toBe("function");
		expect(typeof bundle.comprehensiveCrawl).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
	});
});
