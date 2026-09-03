import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import type { TestAppFixture } from "@packages/test-fixtures";
import type { UserId } from "@packages/domain/user";
import { initReadabilityParser } from "@packages/article-parser";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const FIXED_NOW = new Date("2026-04-25T12:00:00.000Z");

const ARTICLE_HTML = `
<html><head><title>Cache Post</title></head>
<body><article>
	<h1>Cache Post</h1>
	<p>Long enough body text for the readability parser to extract a clean article from.</p>
	<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
</article></body></html>`;

function buildFixture(opts?: { summaryReady?: boolean }): TestAppFixture {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html: ARTICLE_HTML,
		bodyHash: "sha256-stub",
	});
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		siteRules: [],
		logError: createNoopLogError(),
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: base.articleStore,
		articleCrawl: base.articleCrawl,
		parseArticle,
	});
	return {
		...base,
		shared: { ...base.shared, now: () => FIXED_NOW },
		parser: { parseArticle, crawlArticle },
		summary: opts?.summaryReady
			? {
					...base.summary,
					findGeneratedSummary: async () => ({
						status: "ready",
						summary: "A concise summary.",
						excerpt: "Lead line.",
					}),
				}
			: base.summary,
		events: {
			...base.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	};
}

function varyFields(header: string | undefined): string[] {
	assert(header, "the reader must carry a Vary header");
	return header.split(",").map((field) => field.trim().toLowerCase());
}

function readerVersionFrom(listingHtml: string): { articleId: string; version: string } {
	const doc = new JSDOM(listingHtml).window.document;
	const card = doc.querySelector("[data-test-article-list] .readlist-article");
	assert(card, "the saved article must show up in the listing");
	const articleId = card.getAttribute("data-test-article");
	assert(articleId, "the card must carry its id");
	const titleLink = doc.querySelector("[data-test-article-title]");
	assert(titleLink, "the card must render a title link into the reader");
	const href = titleLink.getAttribute("href");
	assert(href, "the title link must carry an href");
	const version = new URL(href, TEST_APP_ORIGIN).searchParams.get("v");
	assert(version, "the reader link must carry a content version");
	return { articleId, version };
}

type Harness = ReturnType<typeof useApp>;

async function saveArticle(harness: Harness, url: string) {
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url });
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in user must exist");
	return { agent, userId: user.userId };
}

async function settleRelated(fixture: TestAppFixture, userId: UserId, url: string) {
	await fixture.relatedArticles.markRelatedArticlesSkipped({ userId, url, at: FIXED_NOW });
}

describe("Reader view browser cache (GET /queue/:id/view)", () => {
	it("links the card to a versioned reader URL", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-link";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { version } = readerVersionFrom((await agent.get("/queue")).text);
		assert.match(version, /^[0-9a-f]{16}$/);
	});

	it("caches a settled reader for 30 minutes when the requested version is current", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-hit";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?v=${version}`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, max-age=1800");
		expect(varyFields(response.headers.vary)).toEqual(["accept", "origin", "cookie"]);
		assert(response.headers.etag?.startsWith('W/"'), "the reader must carry a weak ETag");
	});

	it("shares one nonce-neutral ETag across two identical settled renders", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-stable";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const first = await agent.get(`/queue/${articleId}/view?v=${version}`);
		const second = await agent.get(`/queue/${articleId}/view?v=${version}`);

		expect(first.headers.etag).toBe(second.headers.etag);
	});

	it("answers a revalidation of an unchanged reader with 304 and no body", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-304";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const fresh = await agent.get(`/queue/${articleId}/view?v=${version}`);
		const etag = fresh.headers.etag;
		assert(etag, "the reader must carry an ETag");

		const revalidated = await agent.get(`/queue/${articleId}/view?v=${version}`).set("If-None-Match", etag);

		expect(revalidated.status).toBe(304);
		expect(revalidated.text).toBe("");
		expect(revalidated.headers.etag).toBe(etag);
		expect(revalidated.headers["cache-control"]).toBe("private, max-age=1800");
	});

	it("revalidates the permalink with no version", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-noversion";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("revalidates when the requested version is stale", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-stale";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?v=0000000000000000`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("revalidates when the version is a repeated query parameter", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-array";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?v=${version}&v=other`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("revalidates a matching version while the summary is still loading", async () => {
		const fixture = buildFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-pending-summary";
		const { agent } = await saveArticle(harness, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?v=${version}`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("applies the same policy to the iOS chromeless render", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-ios";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?platform=ios&v=${version}`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, max-age=1800");
	});

	it("mints a new ETag when the read/unread label changes even though the version is unchanged", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-status";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const before = await agent.get(`/queue/${articleId}/view?v=${version}`);
		const staleEtag = before.headers.etag;
		assert(staleEtag, "the settled reader must carry an ETag");

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		const after = await agent.get(`/queue/${articleId}/view?v=${version}`).set("If-None-Match", staleEtag);
		expect(after.status).toBe(200);
		expect(after.headers.etag).not.toBe(staleEtag);
	});
});
