import assert from "node:assert/strict";
import { ALL_COVERAGE_RULES_OFF } from "@packages/domain/article";
import type { CoverageRuleModes } from "@packages/domain/article";
import {
	initComprehensiveParserDepBundle,
	initParserDepBundle,
} from "./parser";

describe("initParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
			findAdoptedFetchUrl: async () => undefined,
			coverageRuleModes: ALL_COVERAGE_RULES_OFF,
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
			logThumbnailNotDelivered: () => {},
			findAdoptedFetchUrl: async () => undefined,
			coverageRuleModes: ALL_COVERAGE_RULES_OFF,
		});

		expect(bundle.isSiteRuleUrl("https://example.com/story")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://medium.com/@author/post")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://x.com/user/status/1")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://twitter.com/user/status/1")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://apple.news/A123")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://stackoverflow.com/questions/42/why")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://stackoverflow.com/tags/java")).toBe(false);
	});
});

describe("initComprehensiveParserDepBundle", () => {
	it("returns a bundle with crawlFetch, crawlArticle, and parseHtml fields", () => {
		const bundle = initComprehensiveParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
			findAdoptedFetchUrl: async () => undefined,
			coverageRuleModes: ALL_COVERAGE_RULES_OFF,
			egress: { kind: "direct-then-proxy", proxyUrl: "http://proxy.test:8080" },
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
			logThumbnailNotDelivered: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
			findAdoptedFetchUrl: async () => undefined,
			coverageRuleModes: ALL_COVERAGE_RULES_OFF,
			egress: { kind: "direct-then-proxy", proxyUrl: "http://proxy.test:8080" },
		});

		expect(bundle.isSiteRuleUrl("https://example.com/story")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://medium.com/@author/post")).toBe(false);
		expect(bundle.isSiteRuleUrl("https://x.com/user/status/1")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://twitter.com/user/status/1")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://apple.news/A123")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://stackoverflow.com/questions/42/why")).toBe(true);
		expect(bundle.isSiteRuleUrl("https://stackoverflow.com/tags/java")).toBe(false);
	});
});

const SECTIONLESS_PAGE = {
	url: "https://example.com/story",
	documentUrl: "https://example.com/story",
	html: `<html><head><title>Story</title></head><body><article><h1>Story</h1>${"<p>A paragraph of readable story text that is long enough to keep.</p>".repeat(12)}</article></body></html>`,
	thumbnailUrl: null,
};

function coverageOf(result: ReturnType<ReturnType<typeof initParserDepBundle>["parseHtml"]>) {
	assert(result.ok, "the sectionless page parses");
	return result.coverage.map((entry) => ({ ruleId: entry.ruleId, mode: entry.mode }));
}

describe("coverage rule modes", () => {
	const shadow: CoverageRuleModes = { "section-coverage": "shadow" };

	it("runs no coverage rule while every rule is off", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
			findAdoptedFetchUrl: async () => undefined,
			coverageRuleModes: ALL_COVERAGE_RULES_OFF,
		});

		expect(coverageOf(bundle.parseHtml(SECTIONLESS_PAGE))).toEqual([]);
	});

	it("inspects with the section rule in the mode the simple bundle is given", () => {
		const bundle = initParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
			findAdoptedFetchUrl: async () => undefined,
			coverageRuleModes: shadow,
		});

		expect(coverageOf(bundle.parseHtml(SECTIONLESS_PAGE))).toEqual([{ ruleId: "section-coverage", mode: "shadow" }]);
	});

	it("inspects with the section rule in the mode the comprehensive bundle is given", () => {
		const bundle = initComprehensiveParserDepBundle({
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
			extractPdf: async () => ({ kind: "failed", reason: "stub" }),
			findAdoptedFetchUrl: async () => undefined,
			egress: { kind: "direct-then-proxy", proxyUrl: "http://proxy.test:8080" },
			coverageRuleModes: shadow,
		});

		expect(coverageOf(bundle.parseHtml(SECTIONLESS_PAGE))).toEqual([{ ruleId: "section-coverage", mode: "shadow" }]);
	});
});
