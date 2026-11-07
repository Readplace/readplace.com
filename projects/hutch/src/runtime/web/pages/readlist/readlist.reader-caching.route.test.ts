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
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { loginAgent, useTestServer } from "../../../test-app";
import request from "supertest";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";
import { ARTICLE_VERSION_HEADER } from "../../shared/offline-reader/offline-cache";
import { HighlightIdSchema, shownSummary } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

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
		readabilityAdditions,
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
					findGeneratedSummary: async ({ url, viewer }) => shownSummary({ url, viewer, ownerUserId: undefined, summary: {
						status: "ready",
						summary: "A concise summary.",
						excerpt: "Lead line.",
					} }),
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
		expect(varyFields(response.headers.vary)).toEqual(["accept", "origin", "cookie", "user-agent"]);
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

	it("revalidates a reader whose row never asked for related saves, so an automatic save's reader is not browser-cached", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-never-asked";
		const { agent } = await saveArticle(harness, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?v=${version}`);

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

	it("leaves Cookie out of Vary on the iOS chromeless render, so the app's cached copy still matches after it mints a new session cookie", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-ios-vary";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?platform=ios&v=${version}`);

		expect(response.status).toBe(200);
		expect(varyFields(response.headers.vary)).toEqual(["accept", "origin"]);
	});

	it("answers a prefetch with the same policy and ETag as the open that follows it, so the prefetched copy is the one a real open would get", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-prefetch";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const prefetched = await agent.get(`/queue/${articleId}/view?v=${version}`).set("Purpose", "prefetch");
		const opened = await agent.get(`/queue/${articleId}/view?v=${version}`);

		expect(prefetched.status).toBe(200);
		expect(prefetched.headers["cache-control"]).toBe("private, max-age=1800");
		assert(opened.headers.etag?.startsWith('W/"'), "the opened reader must carry a weak ETag");
		expect(prefetched.headers.etag).toBe(opened.headers.etag);
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

	it("tells the iOS reader which content version it rendered, the same one the card links to", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-ios-version";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const response = await agent.get(`/queue/${articleId}/view?platform=ios`);

		expect(response.status).toBe(200);
		expect(response.headers[ARTICLE_VERSION_HEADER.toLowerCase()]).toBe(version);
	});

	it("advertises each Siren article's content version, the same one the card links to and the iOS reader reports", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-siren-version";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);

		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		const accessToken = await saveAccessTokenForUser(harness, userId);
		const collection = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(collection.status).toBe(200);
		expect(collection.body.entities.map((entity: { properties: { id: string; contentVersion: string } }) => entity.properties)).toEqual([
			expect.objectContaining({ id: articleId, contentVersion: version }),
		]);
	});

	it("re-versions the card link, the iOS reader and the Siren entity when only the served body changes", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-served-body";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);
		const { articleId, version: before } = readerVersionFrom((await agent.get("/queue")).text);

		await fixture.articleStore.writeContent({ url, content: "<p>Another body under the same metadata.</p>" });

		const { version: after } = readerVersionFrom((await agent.get("/queue")).text);
		const iosReader = await agent.get(`/queue/${articleId}/view?platform=ios`);
		const accessToken = await saveAccessTokenForUser(harness, userId);
		const collection = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);
		const staleReader = await agent.get(`/queue/${articleId}/view?v=${before}`);

		expect(after).not.toBe(before);
		expect(iosReader.headers[ARTICLE_VERSION_HEADER.toLowerCase()]).toBe(after);
		expect(collection.body.entities.map((entity: { properties: { id: string; contentVersion: string } }) => entity.properties)).toEqual([
			expect.objectContaining({ id: articleId, contentVersion: after }),
		]);
		expect(staleReader.headers["cache-control"]).toBe("private, no-cache");
	});
});

describe("Reader view browser cache with highlights (GET /queue/:id/view?feature=highlight)", () => {
	type Agent = Awaited<ReturnType<typeof loginAgent>>;
	const flagged = ({ articleId, version }: { articleId: string; version?: string }) =>
		`/queue/${articleId}/view?${version === undefined ? "" : `v=${version}&`}feature=highlight`;

	async function highlight(agent: Agent, articleId: string): Promise<string> {
		const exact = "readability parser";
		const content = new JSDOM((await agent.get(flagged({ articleId }))).text).window.document.querySelector(
			".article-body__content",
		);
		assert(content, "the flagged reader must render its content");
		const start = normaliseText(collectTextChunks<Node>(content)).text.indexOf(exact);
		assert(start >= 0, "the served text must hold the passage");
		const created = await agent
			.post(`/queue/${articleId}/highlights?feature=highlight`)
			.type("form")
			.send({ exact, start: String(start), end: String(start + exact.length), origin: "mouse" });
		assert.equal(created.status, 303);
		const match = /#highlight-(.+)$/.exec(created.headers.location);
		assert(match, "the create redirect must name the new highlight");
		return match[1];
	}

	it("answers private, no-cache on the card's versioned link to a highlighted article", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-highlighted";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);
		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);
		await highlight(agent, articleId);

		const response = await agent.get(flagged({ articleId, version }));

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("changes the version header on a create, an anchor revision bump and a delete", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-highlight-version";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);
		const { articleId } = readerVersionFrom((await agent.get("/queue")).text);
		const versionOf = async () =>
			(await agent.get(flagged({ articleId }))).headers[ARTICLE_VERSION_HEADER.toLowerCase()];

		const initial = await versionOf();
		const id = await highlight(agent, articleId);
		const created = await versionOf();
		fixture.highlights.bumpAnchorRevision({
			userId,
			url: ArticleResourceUniqueId.parse(url).value,
			highlightId: HighlightIdSchema.parse(id),
		});
		const bumped = await versionOf();
		await agent.post(`/queue/${articleId}/highlights/${id}/delete?feature=highlight`);
		const deleted = await versionOf();

		expect([created === initial, bumped === created, deleted === bumped]).toEqual([false, false, false]);
	});

	it("keeps the 30-minute cache and the 304 for an article without highlights", async () => {
		const fixture = buildFixture({ summaryReady: true });
		const harness = useApp(fixture);
		const url = "https://example.com/reader-cache-no-highlights";
		const { agent, userId } = await saveArticle(harness, url);
		await settleRelated(fixture, userId, url);
		const { articleId, version } = readerVersionFrom((await agent.get("/queue")).text);

		const fresh = await agent.get(flagged({ articleId, version }));
		const etag = fresh.headers.etag;
		assert(etag, "the reader must carry an ETag");
		const revalidated = await agent.get(flagged({ articleId, version })).set("If-None-Match", etag);

		expect(fresh.headers["cache-control"]).toBe("private, max-age=1800");
		expect(fresh.headers[ARTICLE_VERSION_HEADER.toLowerCase()]).toBe(version);
		expect(revalidated.status).toBe(304);
		expect(revalidated.headers["cache-control"]).toBe("private, max-age=1800");
	});
});
