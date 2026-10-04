import { MinutesSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { initResolveSaveIdentity, initSubmitFreshness, neverResolveWrapperTarget } from "@packages/save-article";
import type { PublishLinkQueued, PublishLinkSaved, PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, type TestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const ORIGINAL = "http://www.onscreenasia.com/article-106.html";
const WAYBACK = `https://web.archive.org/web/20081203185222/${ORIGINAL}`;

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
			resolveWrapperTarget: neverResolveWrapperTarget,
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

describe("Saving an archive capture", () => {
	it("keys the article on the original, pins the capture as its content source and primes the crawl on the original", async () => {
		const { fixture, harness, linkSaves, linkQueued } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: WAYBACK });

		expect(response.status).toBe(303);
		expect(await fixture.articleStore.findArticleByUrl(WAYBACK)).toBeNull();
		expect(await fixture.articleStore.findArticleByUrl(ORIGINAL)).not.toBeNull();
		expect(await fixture.articleStore.findContentSourceUrl(ORIGINAL)).toBe(WAYBACK);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(ORIGINAL)).toEqual({ status: "pending" });
		expect(linkSaves).toEqual([
			{ url: ORIGINAL, userId: expect.any(String) },
			{ url: ORIGINAL, userId: expect.any(String), captureUrl: WAYBACK },
		]);
		expect(linkQueued).toEqual([{ url: WAYBACK, userId: expect.any(String) }]);
	});

	it("keys a Wayback calendar URL on the original and records the latest capture, without any network", async () => {
		const { fixture, harness, linkSaves } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const calendar = `https://web.archive.org/web/20260000000000*/${ORIGINAL}`;
		const timegate = `https://web.archive.org/web/${ORIGINAL}`;

		await agent.post("/queue/save").type("form").send({ url: calendar });

		expect(await fixture.articleStore.findArticleByUrl(calendar)).toBeNull();
		expect(await fixture.articleStore.findContentSourceUrl(ORIGINAL)).toBe(timegate);
		expect(linkSaves).toContainEqual({ url: ORIGINAL, userId: expect.any(String), captureUrl: timegate });
	});

	it("keys a new save on the original even when an earlier save left a card on the archive URL", async () => {
		const { fixture, harness } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		await fixture.articleStore.saveArticleGlobally({
			url: WAYBACK,
			metadata: { title: "Wayback Machine", siteName: "web.archive.org", excerpt: "", wordCount: 49 },
			estimatedReadTime: MinutesSchema.parse(1),
			savedAt: new Date(),
		});

		await agent.post("/queue/save").type("form").send({ url: WAYBACK });

		expect(await fixture.articleStore.findArticleByUrl(ORIGINAL)).not.toBeNull();
		expect(await fixture.articleStore.findContentSourceUrl(ORIGINAL)).toBe(WAYBACK);
	});

	it("re-primes an original whose crawl failed, now reading from the pinned capture", async () => {
		const { fixture, harness, staleChecks } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: ORIGINAL });
		await fixture.articleCrawl.markCrawlFailed({ url: ORIGINAL, reason: "dead origin" });

		await agent.post("/queue/save").type("form").send({ url: WAYBACK });

		expect(await fixture.articleCrawl.findArticleCrawlStatus(ORIGINAL)).toEqual({ status: "pending" });
		expect(await fixture.articleStore.findContentSourceUrl(ORIGINAL)).toBe(WAYBACK);
		expect(staleChecks).toEqual([]);
	});

	it("attaches to an original that already has live content and offers the capture to the content judge", async () => {
		const { fixture, harness, staleChecks, linkSaves } = createHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: ORIGINAL });
		await fixture.articleCrawl.markCrawlReady({ url: ORIGINAL });
		linkSaves.length = 0;

		await agent.post("/queue/save").type("form").send({ url: WAYBACK });

		expect(await fixture.articleCrawl.findArticleCrawlStatus(ORIGINAL)).toEqual({ status: "ready" });
		expect(await fixture.articleStore.findContentSourceUrl(ORIGINAL)).toBe(WAYBACK);
		expect(staleChecks).toEqual([{ url: ORIGINAL }]);
		expect(linkSaves).toEqual([{ url: ORIGINAL, userId: expect.any(String), captureUrl: WAYBACK }]);
	});
});
