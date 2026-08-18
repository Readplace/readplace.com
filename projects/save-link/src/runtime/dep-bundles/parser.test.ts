import {
	initComprehensiveParserDepBundle,
	initParserDepBundle,
} from "./parser";

describe("initParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			findAdoptedFetchUrl: async () => undefined,
			proxyUrl: undefined,
		});

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.crawlArticle).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
		expect(typeof bundle.isSiteRuleUrl).toBe("function");
	});

	it("scopes isSiteRuleUrl to crawl-claiming rules so ordinary terminals still adopt", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			findAdoptedFetchUrl: async () => undefined,
			proxyUrl: undefined,
		});

		expect(bundle.isSiteRuleUrl("https://example.com/story")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://medium.com/@author/post")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://x.com/user/status/1")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://apple.news/A123")).toBe(true);
	});
});

describe("initComprehensiveParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initComprehensiveParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
			findAdoptedFetchUrl: async () => undefined,
			proxyUrl: undefined,
		});

		expect(typeof bundle.crawlFetch).toBe("function");
		expect(typeof bundle.crawlArticle).toBe("function");
		expect(typeof bundle.parseHtml).toBe("function");
		expect(typeof bundle.isSiteRuleUrl).toBe("function");
	});

	it("scopes isSiteRuleUrl to crawl-claiming rules so ordinary terminals still adopt", () => {
		const bundle = initComprehensiveParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
			findAdoptedFetchUrl: async () => undefined,
			proxyUrl: undefined,
		});

		expect(bundle.isSiteRuleUrl("https://example.com/story")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://medium.com/@author/post")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://x.com/user/status/1")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://apple.news/A123")).toBe(true);
	});
});
