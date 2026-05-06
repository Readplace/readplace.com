import request from "supertest";
import { initRefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { PublishRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { createTestApp, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

async function loginAgent(app: TestAppResult["app"], auth: TestAppResult["auth"]) {
	await auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(app);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
	return agent;
}

describe("Queue freshness integration", () => {
	it("publishes UpdateFetchTimestampCommand on first save, then RefreshArticleContentCommand on re-save", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const refreshPublished: Parameters<PublishRefreshArticleContent>[0][] = [];
		const timestampPublished: Parameters<PublishUpdateFetchTimestamp>[0][] = [];

		const { refreshArticleIfStale } = initRefreshArticleIfStale({
			findArticleFreshness: fixture.articleStore.findArticleFreshness,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			crawlArticle: async (params) => {
				if (!params.etag && !params.lastModified) {
					return {
						status: "fetched",
						html: "<html><head><title>Updated</title></head><body><article><p>New content</p></article></body></html>",
						etag: '"fresh-etag"',
					};
				}
				return { status: "not-modified" };
			},
			parseHtml: () => ({
				ok: true as const,
				article: {
					title: "Updated Article",
					siteName: "example.com",
					excerpt: "New content",
					wordCount: 100,
					content: "<p>New content</p>",
				},
			}),
			publishRefreshArticleContent: async (p) => { refreshPublished.push(p); },
			publishUpdateFetchTimestamp: async (p) => { timestampPublished.push(p); },
			now: () => new Date(),
			staleTtlMs: 0,
		});

		const { app, auth } = createTestApp({
			...fixture,
			events: {
				publishLinkSaved: fixture.events.publishLinkSaved,
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
				publishUpdateFetchTimestamp: async (p) => { timestampPublished.push(p); },
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
			},
			freshness: { refreshArticleIfStale },
		});
		const agent = await loginAgent(app, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(timestampPublished).toHaveLength(1);
		expect(timestampPublished[0]).toEqual({
			url: "https://example.com/article",
			contentFetchedAt: expect.any(String),
		});
		expect(refreshPublished).toHaveLength(0);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(refreshPublished).toHaveLength(1);
		expect(refreshPublished[0]).toEqual({
			url: "https://example.com/article",
			metadata: expect.objectContaining({
				title: "Updated Article",
				siteName: "example.com",
				wordCount: 100,
			}),
			estimatedReadTime: expect.any(Number),
			etag: '"fresh-etag"',
			lastModified: undefined,
			contentFetchedAt: expect.any(String),
		});
	});
});
