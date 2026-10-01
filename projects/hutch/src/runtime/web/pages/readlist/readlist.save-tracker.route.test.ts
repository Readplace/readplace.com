import { noopLogger } from "@packages/hutch-logger";
import { MinutesSchema } from "@packages/domain/article";
import { initResolveSaveIdentity, initSubmitFreshness } from "@packages/save-article";
import type { PublishLinkQueued, PublishLinkSaved, PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, type TestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const PUBLISHER = "https://sqlite.org/lang_with.html";

function createHarness() {
	const fixture: TestAppFixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const staleChecks: Parameters<PublishStaleCheckRequested>[0][] = [];
	const linkSaves: Parameters<PublishLinkSaved>[0][] = [];
	const linkQueued: Parameters<PublishLinkQueued>[0][] = [];
	const { refreshArticleIfStale } = initSubmitFreshness({
		findArticleByUrl: fixture.articleStore.findArticleByUrl,
		findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
		resolveSaveIdentity: initResolveSaveIdentity({
			findIdentityRow: fixture.articleStore.findIdentityRow,
			claimAlias: fixture.articleStore.claimAlias,
			resolveWrapperTarget: fixture.wrapperTarget.resolveWrapperTarget,
			now: () => new Date(),
			logger: noopLogger,
		}),
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
			publishLinkQueued: (async (params) => {
				linkQueued.push(params);
			}) satisfies PublishLinkQueued,
		},
		freshness: { refreshArticleIfStale },
	});
	return { fixture, harness, staleChecks, linkSaves, linkQueued };
}

describe("Saving a newsletter click-tracker", () => {
	it("keys the save on the publisher, aliases the tracker and announces the tracker as the queued link", async () => {
		const { fixture, harness, linkSaves, linkQueued } = createHarness();
		fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: TRACKER });

		expect(response.status).toBe(303);
		expect(fixture.wrapperTarget.calls).toEqual([TRACKER]);
		expect(await fixture.articleStore.findArticleByUrl(TRACKER)).toBeNull();
		expect(await fixture.articleStore.findArticleByUrl(PUBLISHER)).not.toBeNull();
		expect(await fixture.articleStore.findIdentityRow(TRACKER)).toEqual({ kind: "alias", targetUrl: PUBLISHER });
		expect(await fixture.articleCrawl.findArticleCrawlStatus(PUBLISHER)).toEqual({ status: "pending" });
		expect(linkSaves).toEqual([{ url: PUBLISHER, userId: expect.any(String) }]);
		expect(linkQueued).toEqual([{ url: TRACKER, userId: expect.any(String) }]);
		expect(fixture.publishedQueueEntryCreated).toEqual([{ url: PUBLISHER, userId: expect.any(String) }]);
	});

	it("resolves the tracker once — a second save finds the alias", async () => {
		const { fixture, harness } = createHarness();
		fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: TRACKER });
		await agent.post("/queue/save").type("form").send({ url: TRACKER });

		expect(fixture.wrapperTarget.calls).toEqual([TRACKER]);
		expect(await fixture.articleStore.findArticleByUrl(TRACKER)).toBeNull();
	});

	it("attaches to the article a crawl already adopted the publisher into, never to the alias", async () => {
		const { fixture, harness, linkSaves } = createHarness();
		const firstWrapper = "https://leadershipintech.com/links/1/0b1f0d9c-3b6e-4f9d-9a1e-6f0d5c8e2a11/email";
		await fixture.articleStore.saveArticleGlobally({
			url: firstWrapper,
			metadata: { title: "T", siteName: "sqlite.org", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(1),
			savedAt: new Date(),
		});
		await fixture.articleCrawl.markCrawlReady({ url: firstWrapper });
		await fixture.articleStore.claimAlias({ aliasUrl: PUBLISHER, targetOriginalUrl: firstWrapper, now: new Date() });
		fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: TRACKER });

		expect(response.status).toBe(303);
		expect(await fixture.articleStore.findIdentityRow(TRACKER)).toEqual({ kind: "alias", targetUrl: firstWrapper });
		expect(await fixture.articleStore.findArticleByUrl(PUBLISHER)).toBeNull();
		expect(linkSaves).toEqual([]);
	});

	it("keeps the tracker as the identity when the target cannot be resolved", async () => {
		const { fixture, harness, linkSaves } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: TRACKER });

		expect(response.status).toBe(303);
		expect(fixture.wrapperTarget.calls).toEqual([TRACKER]);
		expect(await fixture.articleStore.findArticleByUrl(TRACKER)).not.toBeNull();
		expect(await fixture.articleStore.findIdentityRow(TRACKER)).toEqual({ kind: "article" });
		expect(linkSaves).toEqual([{ url: TRACKER, userId: expect.any(String) }]);
	});
});
