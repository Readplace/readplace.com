import { initRefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { PublishRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

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

		const harness = useApp({
			...fixture,
			events: {
				publishLinkSaved: fixture.events.publishLinkSaved,
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: async (p) => { timestampPublished.push(p); },
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
			},
			freshness: { refreshArticleIfStale },
		});
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

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
			html: expect.any(String),
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
