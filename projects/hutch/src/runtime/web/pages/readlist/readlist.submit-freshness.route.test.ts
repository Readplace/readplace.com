import assert from "node:assert/strict";
import { initSubmitFreshness } from "@packages/save-article";
import { noopLogger } from "@packages/logger";
import type { PublishLinkSaved, PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { initRequestStaleCheck } from "../../../domain/stale-check/request-stale-check";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

const articleUrl = "https://example.com/article";

describe("Readlist save through submit freshness", () => {
	it("re-saving a settled article requests an async stale check instead of crawling in the request, uncounted for a founding account", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const staleChecks: Parameters<PublishStaleCheckRequested>[0][] = [];
		const linkSaves: Parameters<PublishLinkSaved>[0][] = [];
		const { refreshArticleIfStale } = initSubmitFreshness({
			findArticleByUrl: fixture.articleStore.findArticleByUrl,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			resolveSaveIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
			requestStaleCheck: initRequestStaleCheck({
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rule: { limit: 1, windowSeconds: 86400 },
				publishStaleCheckRequested: async (params) => {
					staleChecks.push(params);
				},
				getEffectiveAccess: initGetEffectiveAccess({ findSubscriptionByUserId: fixture.subscriptionProviders.findByUserId, now: () => new Date() }),
				logger: noopLogger,
			}).requestStaleCheck,
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

		expect(linkSaves).toEqual([{ url: articleUrl, userId: expect.any(String), saveAttemptId: expect.any(String) }]);
		expect(staleChecks).toEqual([]);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(articleUrl)).toEqual({
			status: "pending",
			startedAt: expect.any(String),
		});

		await fixture.articleCrawl.markCrawlReady({ url: articleUrl });
		await agent.post("/queue/save").type("form").send({ url: articleUrl });

		expect(staleChecks).toEqual([{ url: articleUrl }]);
		expect(linkSaves).toHaveLength(1);

		await agent.post("/queue/save").type("form").send({ url: articleUrl });

		expect(staleChecks).toEqual([{ url: articleUrl }, { url: articleUrl }]);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(articleUrl)).toEqual({
			status: "ready",
		});
	});

	it("saves for a free account at the stale-check cap, and its save publishes no stale check", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const staleChecks: Parameters<PublishStaleCheckRequested>[0][] = [];
		const { refreshArticleIfStale } = initSubmitFreshness({
			findArticleByUrl: fixture.articleStore.findArticleByUrl,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			resolveSaveIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
			requestStaleCheck: initRequestStaleCheck({
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rule: { limit: 0, windowSeconds: 86400 },
				publishStaleCheckRequested: async (params) => {
					staleChecks.push(params);
				},
				getEffectiveAccess: initGetEffectiveAccess({ findSubscriptionByUserId: fixture.subscriptionProviders.findByUserId, now: () => new Date() }),
				logger: noopLogger,
			}).requestStaleCheck,
		});
		const harness = useApp({ ...fixture, freshness: { refreshArticleIfStale } });
		const agent = await loginAgent(harness.server, harness.auth);
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the signed-in reader must exist");
		await harness.subscriptionProviders.upsertActive({ userId: user.userId, subscriptionId: "sub_free", customerId: "cus_free" });
		await harness.subscriptionProviders.markCancelledByUserId({ userId: user.userId });
		await agent.post("/queue/save").type("form").send({ url: articleUrl });
		await fixture.articleCrawl.markCrawlReady({ url: articleUrl });

		const response = await agent.post("/queue/save").type("form").send({ url: articleUrl });

		expect([response.status, response.headers.location]).toEqual([303, "/queue?queue=default#latest-saved"]);
		expect(staleChecks).toEqual([]);
	});
});
