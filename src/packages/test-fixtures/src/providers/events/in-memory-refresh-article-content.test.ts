import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
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

	it("resolves with a noop logger", async () => {
		const { publishRefreshArticleContent } = initInMemoryRefreshArticleContent({
			logger: HutchLogger.from(noopLogger),
		});

		await assert.doesNotReject(
			publishRefreshArticleContent({
				url: "https://example.com/other",
				html: "<p>x</p>",
				metadata: {
					title: "Other",
					siteName: "Other Site",
					excerpt: "x",
					wordCount: 1,
				},
				estimatedReadTime: 1,
				contentFetchedAt: "2026-06-21T00:00:00.000Z",
				bodyHash: "hash2",
			}),
		);
	});
});
