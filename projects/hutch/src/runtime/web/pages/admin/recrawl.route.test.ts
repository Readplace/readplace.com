import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import type { ParseArticle, ParseArticleResult } from "@packages/test-fixtures/providers/article-parser";
import { useTestServer, type TestAppHarness } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeSummaryProvider,
} from "@packages/test-fixtures";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const OTHER_EMAIL = "other@readplace.com";
const OTHER_PASSWORD = "password456";
const ARTICLE_URL = "https://example.com/post";
const ENCODED = encodeURIComponent(ARTICLE_URL);

function buildParseResult(): ParseArticleResult {
	return {
		ok: true,
		article: {
			title: "Hello World",
			siteName: "example.com",
			excerpt: "A lovely article.",
			wordCount: 500,
			content: "<p>Body copy.</p>",
			imageUrl: "https://cdn.example.com/hero.jpg",
		},
	};
}

interface RecrawlHarness {
	server: Server;
	auth: TestAppHarness["auth"];
	articleStore: TestAppHarness["articleStore"];
	articleCrawl: TestAppHarness["articleCrawl"];
	summary: ReturnType<typeof createFakeSummaryProvider>;
	recrawlPublishedCalls: { url: string }[];
}

const useApp = useTestServer();

function buildHarness(options: { adminEmails: readonly string[] }): RecrawlHarness {
	const parseArticle: ParseArticle = async () => buildParseResult();
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	// Locally-constructed summary so the harness carries the test-only
	// `markSummaryReady` helper alongside the production-shaped bundle.
	const summary = createFakeSummaryProvider();

	// The admin route is supposed to force `crawlStatus = pending` and then
	// publish. We want to assert the page renders in pending state, so the
	// publisher here is a pure recorder — it does NOT synchronously run
	// applyParseResult. The eventual worker run is out of scope for these
	// route tests (it's covered by save-link's own tests).
	const recrawlPublishedCalls: { url: string }[] = [];
	const publishRecrawlLinkInitiated = async (params: { url: string }) => {
		recrawlPublishedCalls.push(params);
	};

	const harness = useApp({
		...fixture,
		parser:{
 	parseArticle: parseArticle,
 	crawlArticle: fixture.parser.crawlArticle,
 },
		events: {
			publishLinkSaved: fixture.events.publishLinkSaved,
			publishRecrawlLinkInitiated: publishRecrawlLinkInitiated,
			publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
			publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
			publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
			publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
			publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
		},
		summary,
		admin:{
 	adminEmails: options.adminEmails,
 	recrawlServiceToken: fixture.admin.recrawlServiceToken,
 },
	});

	return {
		server: harness.server,
		auth: harness.auth,
		articleStore: harness.articleStore,
		articleCrawl: harness.articleCrawl,
		summary,
		recrawlPublishedCalls,
	};
}

async function loginAs(
	server: Server,
	email: string,
	password: string,
) {
	const agent = request.agent(server);
	await agent.post("/login").type("form").send({ email, password });
	return agent;
}

describe("Admin recrawl routes", () => {
	describe("authorization", () => {
		it("redirects unauthenticated visitors to /login (303)", async () => {
			const { server } = buildHarness({ adminEmails: [ADMIN_EMAIL] });

			const response = await request(server).get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});

		it("returns 403 when the logged-in user's email is not in the allowlist", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: OTHER_EMAIL, password: OTHER_PASSWORD });
			const agent = await loginAs(server, OTHER_EMAIL, OTHER_PASSWORD);

			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(403);
			expect(response.text).toContain("Admin access required");
		});

		it("returns 403 when the allowlist is empty (fail-closed)", async () => {
			const { server, auth } = buildHarness({ adminEmails: [] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(403);
		});
	});

	describe("GET /admin/recrawl (landing)", () => {
		it("renders the landing form for an admin with no ?url query", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get("/admin/recrawl");

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-admin-recrawl-form]")).not.toBeNull();
			expect(doc.querySelector("[data-test-admin-recrawl-input]")).not.toBeNull();
		});

		it("redirects submitted ?url to the encoded article path", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl?url=${encodeURIComponent(ARTICLE_URL)}`);

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe(`/admin/recrawl/${ENCODED}`);
		});

		it("returns 404 when the submitted ?url is not a valid URL", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get("/admin/recrawl?url=not-a-url");

			expect(response.status).toBe(404);
		});
	});

	describe("GET /admin/recrawl/:url", () => {
		it("returns 404 when the URL is not already in the articles DB", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(404);
		});

		it("renders the Tier 0 badge when the row's contentSourceTier is tier-0 (extension capture)", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleStore.setContentSourceTier({ url: ARTICLE_URL, tier: "tier-0" });
			await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);
			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const badge = doc.querySelector("[data-test-tier-badge]");
			expect(badge?.getAttribute("data-test-tier-badge")).toBe("tier-0");
			expect(badge?.textContent).toContain("Tier 0");
			expect(badge?.textContent).toContain("extension capture");
		});

		it("renders the Tier 1 badge when contentSourceTier is tier-1 (HTTP crawl)", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleStore.setContentSourceTier({ url: ARTICLE_URL, tier: "tier-1" });
			await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);
			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const badge = doc.querySelector("[data-test-tier-badge]");
			expect(badge?.getAttribute("data-test-tier-badge")).toBe("tier-1");
			expect(badge?.textContent).toContain("Tier 1");
			expect(badge?.textContent).toContain("HTTP crawl");
		});

		it("renders the legacy badge when contentSourceTier is unset (rows written before the selector existed)", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);
			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const badge = doc.querySelector("[data-test-tier-badge]");
			expect(badge?.getAttribute("data-test-tier-badge")).toBe("legacy");
			expect(badge?.textContent).toContain("legacy");
		});

		it("triggers a fresh recrawl for a known URL and renders the page in pending state", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			// Seed an article so the admin path has something to recrawl.
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Stale Title",
					siteName: "example.com",
					excerpt: "Stale excerpt",
					wordCount: 10,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			// Previous crawl left the row in a terminal `ready` state. Admin
			// recrawl must flip it back to `pending` via forceMarkCrawlPending.
			await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(harness.recrawlPublishedCalls).toEqual([{ url: ARTICLE_URL }]);
			const doc = new JSDOM(response.text).window.document;
			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			expect(readerSlot?.getAttribute("data-reader-status")).toBe("pending");
			expect(doc.querySelector("[data-test-admin-recrawl]")).not.toBeNull();
			expect(doc.querySelector("[data-share-balloon]")).toBeNull();
			expect(doc.querySelector("[data-test-view-cta]")).toBeNull();
			expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
				"noindex, nofollow",
			);
		});

		it("force-flips a previously ready summary back to pending so the worker regenerates the AI excerpt", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Stale Title",
					siteName: "example.com",
					excerpt: "Stale excerpt",
					wordCount: 10,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			// Summary was generated on a prior crawl. Without the force-pending
			// path, the save-link summarizer's cache short-circuits on `ready`
			// and the AI excerpt is never regenerated.
			harness.summary.markSummaryReady({
				url: ARTICLE_URL,
				summary: "Stale summary",
				excerpt: "Stale excerpt blurb",
			});

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(200);
			const summaryAfter = await harness.summary.findGeneratedSummary(ARTICLE_URL);
			expect(summaryAfter).toEqual({ status: "pending" });
		});
	});

	describe("GET /admin/recrawl/reader (poll) — validation", () => {
		it("returns 400 when the ?url query is missing", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get("/admin/recrawl/reader");

			expect(response.status).toBe(400);
		});
	});

	describe("GET /admin/recrawl/summary (poll) — validation", () => {
		it("returns 400 when the ?url query is missing", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get("/admin/recrawl/summary");

			expect(response.status).toBe(400);
		});
	});

	describe("GET /admin/recrawl/summary (poll)", () => {
		it("renders the summary slot fragment when the crawl is still pending", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Stale Title",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleCrawl.markCrawlPending({ url: ARTICLE_URL });
			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(
				`/admin/recrawl/summary?url=${encodeURIComponent(ARTICLE_URL)}`,
			);

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(response.text).toContain("data-test-reader-summary");
		});
	});

	describe("GET /admin/recrawl/reader (poll)", () => {
		it("defaults pollCount to 0 when the ?poll query is absent", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Stale Title",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleCrawl.markCrawlPending({ url: ARTICLE_URL });
			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(
				`/admin/recrawl/reader?url=${encodeURIComponent(ARTICLE_URL)}`,
			);

			expect(response.status).toBe(200);
			// First poll URL must reference poll=1 (pollCount defaulted to 0, then +1)
			const pollUrl = response.text.match(/hx-get="([^"]+)"/)?.[1];
			expect(pollUrl).toContain("poll");
		});

		it("renders the reader slot fragment and targets /admin/recrawl/reader for the next poll", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Stale Title",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleCrawl.markCrawlPending({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(
				`/admin/recrawl/reader?url=${encodeURIComponent(ARTICLE_URL)}&poll=1`,
			);

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			const pollUrl = response.text.match(/hx-get="([^"]+)"/)?.[1];
			expect(pollUrl).toContain("/admin/recrawl/reader");
			expect(pollUrl).toContain(encodeURIComponent(ARTICLE_URL));
		});
	});
});
