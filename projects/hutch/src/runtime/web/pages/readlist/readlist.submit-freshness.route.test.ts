import { initSubmitFreshness } from "@packages/save-article";
import type { PublishLinkSaved, PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

const articleUrl = "https://example.com/article";

describe("Readlist save through submit freshness", () => {
	it("re-saving a settled article requests an async stale check instead of crawling in the request", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const staleChecks: Parameters<PublishStaleCheckRequested>[0][] = [];
		const linkSaves: Parameters<PublishLinkSaved>[0][] = [];
		const { refreshArticleIfStale } = initSubmitFreshness({
			findArticleByUrl: fixture.articleStore.findArticleByUrl,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			resolveCanonicalIdentity: async (url) => url,
			publishStaleCheckRequested: async (params) => {
				staleChecks.push(params);
			},
		});
		const harness = useApp({
			...fixture,
			events: {
				...fixture.events,
				publishLinkSaved: (async (params) => {
					linkSaves.push(params);
				}) satisfies PublishLinkSaved,
			},
			freshness: { refreshArticleIfStale },
		});
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: articleUrl });

		expect(linkSaves).toEqual([{ url: articleUrl, userId: expect.any(String) }]);
		expect(staleChecks).toEqual([]);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(articleUrl)).toEqual({
			status: "pending",
		});

		await fixture.articleCrawl.markCrawlReady({ url: articleUrl });
		await agent.post("/queue/save").type("form").send({ url: articleUrl });

		expect(staleChecks).toEqual([{ url: articleUrl }]);
		expect(linkSaves).toHaveLength(1);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(articleUrl)).toEqual({
			status: "ready",
		});
	});
});
