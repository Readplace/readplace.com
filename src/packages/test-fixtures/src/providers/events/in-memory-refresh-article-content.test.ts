import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryRefreshArticleContent } from "./in-memory-refresh-article-content";

describe("initInMemoryRefreshArticleContent", () => {
	it("logs once and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => {
				logged.push(args);
			},
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishRefreshArticleContent } = initInMemoryRefreshArticleContent({ logger });

		await publishRefreshArticleContent({
			url: "https://example.com/article",
			html: "<p>hello</p>",
			metadata: {
				title: "Example",
				siteName: "Example Site",
				excerpt: "An excerpt",
				wordCount: 2,
			},
			estimatedReadTime: 1,
			contentFetchedAt: "2026-06-21T00:00:00.000Z",
			bodyHash: "hash",
		});

		assert.equal(logged.length, 1);
	});
});
