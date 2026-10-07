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
			validateUrl: fixture.shared.validateSaveableUrl,
			findIdentityRow: fixture.articleStore.findIdentityRow,
			claimAlias: fixture.articleStore.claimAlias,
			resolveWrapperTarget: fixture.wrapperTarget.resolveWrapperTarget,
			now: () => new Date(),
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
	it("resolves the tracker in the request and keys the save on the publisher", async () => {
		const { fixture, harness, linkSaves, linkQueued } = createHarness();
		fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.post("/queue/save").type("form").send({ url: TRACKER });
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue#latest-saved");
		expect(fixture.wrapperTarget.calls).toEqual([TRACKER]);
		expect(await fixture.articleStore.findArticleByUrl(TRACKER)).toBeNull();
		expect(await fixture.articleStore.findArticleByUrl(PUBLISHER)).not.toBeNull();
		expect(await fixture.articleCrawl.findArticleCrawlStatus(PUBLISHER)).toEqual({ status: "pending" });
		expect(linkSaves).toEqual([expect.objectContaining({ url: PUBLISHER, userId: expect.any(String) })]);
		expect(linkQueued).toEqual([{ url: TRACKER, userId: expect.any(String) }]);
		expect(fixture.submitLink.submitLinks).toEqual([]);
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
	it("queues the tracker with a notice and writes no article when its target cannot be resolved", async () => {
		const { fixture, harness, linkSaves, linkQueued } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.post("/queue/save").type("form").send({ url: TRACKER });
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=save_queued");
		expect(fixture.wrapperTarget.calls).toEqual([TRACKER]);
		expect(await fixture.articleStore.findArticleByUrl(TRACKER)).toBeNull();
		expect(fixture.submitLink.submitLinks).toEqual([expect.objectContaining({ url: TRACKER, saveAttemptId: expect.any(String) })]);
		expect(linkSaves).toEqual([]);
		expect(linkQueued).toEqual([]);
	});
	it("reuses a verified tracker mapping and retries its body on every save", async () => {
		const { fixture, harness, linkSaves, linkQueued } = createHarness();
		await fixture.articleStore.claimAlias({ aliasUrl: TRACKER, targetOriginalUrl: PUBLISHER, sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: PUBLISHER }, now: new Date() });
		const agent = await loginAgent(harness.server, harness.auth);
		for (let count = 0; count < 2; count += 1) await agent.post("/queue/save").type("form").send({ url: TRACKER });
		expect(fixture.wrapperTarget.calls).toEqual([]);
		expect(await fixture.articleStore.findArticleByUrl(TRACKER)).toBeNull();
		expect((await fixture.articleStore.findArticleByUrl(PUBLISHER))?.metadata.siteName).toBe("sqlite.org");
		expect(linkSaves).toHaveLength(2);
		expect(linkSaves).toEqual([expect.objectContaining({ url: PUBLISHER, captureUrl: TRACKER, sourceOriginalUrl: PUBLISHER }), expect.objectContaining({ url: PUBLISHER, captureUrl: TRACKER, sourceOriginalUrl: PUBLISHER })]);
		expect(linkQueued).toEqual([{ url: TRACKER, userId: expect.any(String) }, { url: TRACKER, userId: expect.any(String) }]);
	});
	it("keeps the stable key of a previously adopted article and verifies the tracker against its original", async () => {
		const { fixture, harness, linkSaves } = createHarness();
		const owner = "https://leadershipintech.com/links/1/0b1f0d9c-3b6e-4f9d-9a1e-6f0d5c8e2a11/email";
		await fixture.articleStore.saveArticleGlobally({ url: owner, metadata: { title: "T", siteName: "sqlite.org", excerpt: "", wordCount: 0 }, estimatedReadTime: MinutesSchema.parse(1), savedAt: new Date() });
		await fixture.articleStore.setDisplayUrl({ url: owner, displayUrl: PUBLISHER });
		await fixture.articleCrawl.markCrawlReady({ url: owner });
		await fixture.articleStore.claimAlias({ aliasUrl: PUBLISHER, targetOriginalUrl: owner, now: new Date() });
		await fixture.articleStore.claimAlias({ aliasUrl: TRACKER, targetOriginalUrl: owner, sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: PUBLISHER }, now: new Date() });
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.post("/queue/save").type("form").send({ url: TRACKER });
		expect(response.status).toBe(303);
		expect(await fixture.articleStore.findArticleByUrl(PUBLISHER)).toBeNull();
		expect(linkSaves).toEqual([expect.objectContaining({ url: owner, captureUrl: TRACKER, sourceOriginalUrl: PUBLISHER })]);
	});
});
