import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { isCardTerminal } from "./is-card-terminal";

describe("isCardTerminal", () => {
	it("is non-terminal while the crawl is pending", () => {
		const crawl: ArticleCrawl = { status: "pending" };
		const summary: GeneratedSummary = { status: "pending" };
		expect(isCardTerminal(crawl, summary)).toBe(false);
	});

	it("is non-terminal while crawl ready but summary pending", () => {
		const crawl: ArticleCrawl = { status: "ready" };
		const summary: GeneratedSummary = { status: "pending" };
		expect(isCardTerminal(crawl, summary)).toBe(false);
	});

	it("is terminal when crawl ready and summary ready", () => {
		const crawl: ArticleCrawl = { status: "ready" };
		const summary: GeneratedSummary = {
			status: "ready",
			summary: "TL;DR.",
		};
		expect(isCardTerminal(crawl, summary)).toBe(true);
	});

	it("is terminal when crawl ready and summary skipped", () => {
		const crawl: ArticleCrawl = { status: "ready" };
		const summary: GeneratedSummary = {
			status: "skipped",
			reason: "content-too-short",
		};
		expect(isCardTerminal(crawl, summary)).toBe(true);
	});

	it("is terminal when crawl ready and summary failed", () => {
		const crawl: ArticleCrawl = { status: "ready" };
		const summary: GeneratedSummary = {
			status: "failed",
			reason: "deepseek timeout",
		};
		expect(isCardTerminal(crawl, summary)).toBe(true);
	});

	it("is terminal as soon as the crawl fails, regardless of summary state", () => {
		const crawl: ArticleCrawl = { status: "failed", reason: "blocked" };
		const summary: GeneratedSummary = { status: "pending" };
		expect(isCardTerminal(crawl, summary)).toBe(true);
	});

	it("is non-terminal when both crawl and summary are missing (legacy heal)", () => {
		expect(isCardTerminal(undefined, undefined)).toBe(false);
	});

	it("is non-terminal when crawl ready but summary row not yet written", () => {
		const crawl: ArticleCrawl = { status: "ready" };
		expect(isCardTerminal(crawl, undefined)).toBe(false);
	});
});
