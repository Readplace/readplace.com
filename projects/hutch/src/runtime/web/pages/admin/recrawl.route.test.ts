import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import type { ParseArticle, ParseArticleResult } from "@packages/article-parser";
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
			publishLinkQueued: fixture.events.publishLinkQueued,
			publishLinkDequeued: fixture.events.publishLinkDequeued,
			publishComputeRelatedArticles: fixture.events.publishComputeRelatedArticles,
			publishRecrawlLinkInitiated: publishRecrawlLinkInitiated,
			publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
			publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
			publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
			publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
			publishRemoveMyContent: fixture.events.publishRemoveMyContent,
			publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
			publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
			publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
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
			const form = doc.querySelector("[data-test-admin-recrawl-form]");
			assert(form);
			expect(form.getAttribute("action")).toBe("/admin/recrawl");
			expect(form.getAttribute("method")).toBe("GET");
			const input = doc.querySelector("[data-test-admin-recrawl-input]");
			assert(input);
			expect(input.getAttribute("name")).toBe("url");
			expect(input.getAttribute("type")).toBe("url");
		});

		it("renders the recrawl page in place for a submitted ?url — redirecting into the path form would collapse an embedded scheme back out of the address", async () => {
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

			const response = await agent.get(`/admin/recrawl?url=${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			assert(doc.querySelector("[data-test-admin-recrawl]"));
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

		it("points 'View original' at the adopted redirect destination", async () => {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleStore.setDisplayUrl({
				url: ARTICLE_URL,
				displayUrl: "https://destination.example/article",
			});
			await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);
			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				"https://destination.example/article",
			);
		});

		it("keeps 'View original' on the saved URL when no redirect was ever resolved", async () => {
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
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				ARTICLE_URL,
			);
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

		it("renders the page read-only with an auto-submitting POST form (no mutation on GET)", async () => {
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
			await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			// GET is read-only: the recrawl must not have been triggered.
			expect(harness.recrawlPublishedCalls).toEqual([]);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector("[data-test-admin-recrawl-trigger]");
			expect(form?.getAttribute("method")).toBe("POST");
			// The form must POST to the lossless `?url=` carrier: a path action
			// would collapse an embedded scheme the moment the browser submits.
			expect(form?.getAttribute("action")).toBe(`/admin/recrawl?url=${ENCODED}`);
			expect(form?.hasAttribute("data-auto-submit")).toBe(true);
			expect(response.text).toContain("requestSubmit");
			const recrawlMain = doc.querySelector("[data-test-admin-recrawl]");
			assert(recrawlMain);
			assert(recrawlMain.querySelector(".admin-recrawl__body [data-test-reader-slot]"));
			assert(recrawlMain.querySelector(".admin-recrawl__body[data-article-body]"));
			expect(response.text).toContain(
				'<script src="/client-dist/reader-nav.client.js" defer></script>',
			);
			expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
				"noindex, nofollow",
			);
		});

		it("triggers a fresh recrawl on POST and redirects (303) to the started result view rendered in pending state", async () => {
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

			const postResponse = await agent.post(`/admin/recrawl/${ENCODED}`);

			expect(postResponse.status).toBe(303);
			expect(postResponse.headers.location).toBe(
				`/admin/recrawl?url=${ENCODED}&started=1`,
			);
			expect(harness.recrawlPublishedCalls).toEqual([{ url: ARTICLE_URL }]);

			const response = await agent.get(`/admin/recrawl?url=${ENCODED}&started=1`);

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			const doc = new JSDOM(response.text).window.document;
			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			expect(readerSlot?.getAttribute("data-reader-status")).toBe("pending");
			// The result view must not re-emit the auto-submit form.
			expect(doc.querySelector("[data-test-admin-recrawl-trigger]")).toBeNull();
		});

		it("returns 404 on POST when the URL is not already in the articles DB", async () => {
			const { server, auth } = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			const agent = await loginAs(server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.post(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(404);
		});

		it("treats a schemeless POST path segment as https:// so admins can paste `host/path` without typing the scheme", async () => {
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
			// A schemeless path segment must still resolve to a URL, not be rejected as missing.
			const response = await agent.post("/admin/recrawl/example.com/post");

			expect(response.status).toBe(303);
			expect(harness.recrawlPublishedCalls).toEqual([{ url: ARTICLE_URL }]);
		});

		it("preserves the existing ready summary on the admin recrawl trigger — summary regeneration is decided downstream by the canonicalContentHash gate, not by wiping state up front", async () => {
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
			// Summary was generated on a prior crawl. Wiping it here would mean
			// a guaranteed DeepSeek call on every admin recrawl regardless of
			// whether the readable content actually changed. The hash gate in
			// recrawlPromoteTier / recrawlTieKeptCanonical now owns that decision.
			harness.summary.markSummaryReady({
				url: ARTICLE_URL,
				summary: "Existing summary",
				excerpt: "Existing summary blurb",
			});

			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.post(`/admin/recrawl/${ENCODED}`);

			expect(response.status).toBe(303);
			const summaryAfter = await harness.summary.findGeneratedSummary(ARTICLE_URL);
			expect(summaryAfter).toEqual({
				status: "ready",
				summary: "Existing summary",
				excerpt: "Existing summary blurb",
			});
		});
	});

	// A wayback capture keys the row on a URL that embeds a second scheme. The
	// path carrier cannot express it: the edge decodes `%2F` and collapses `//`
	// before Express sees the path, and only a leading scheme is recoverable, so
	// `…im_/https://site/x` resolves to the `https:/site/x` row instead — a
	// different article, silently healed in place of the one that failed.
	describe("embedded-scheme URLs (wayback captures)", () => {
		const EMBEDDED_URL =
			"https://web.archive.org/web/20260707152150im_/https://www.tampabay.com/a.jpg?auth=abc";
		const EMBEDDED_ENCODED = encodeURIComponent(EMBEDDED_URL);

		async function seedEmbeddedArticle() {
			const harness = buildHarness({ adminEmails: [ADMIN_EMAIL] });
			await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
			await harness.articleStore.saveArticleGlobally({
				url: EMBEDDED_URL,
				metadata: { title: "T", siteName: "web.archive.org", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: new Date(),
			});
			await harness.articleCrawl.markCrawlReady({ url: EMBEDDED_URL });
			return harness;
		}

		it("triggers the recrawl against the exact stored URL when addressed via ?url=", async () => {
			const harness = await seedEmbeddedArticle();
			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.post(`/admin/recrawl?url=${EMBEDDED_ENCODED}`);

			expect(response.status).toBe(303);
			// The published URL must keep BOTH slashes of the embedded scheme —
			// one lost slash addresses a different DynamoDB row.
			expect(harness.recrawlPublishedCalls).toEqual([{ url: EMBEDDED_URL }]);
		});

		it("renders the page for the exact stored URL via ?url=, with a form and canonical link that round-trip it unchanged", async () => {
			const harness = await seedEmbeddedArticle();
			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			const response = await agent.get(`/admin/recrawl?url=${EMBEDDED_ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector("[data-test-admin-recrawl-trigger]");
			expect(form?.getAttribute("action")).toBe(`/admin/recrawl?url=${EMBEDDED_ENCODED}`);
			// The canonical link is an address too: the path form would point at
			// the collapsed twin of this row.
			expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toContain(
				`/admin/recrawl?url=${EMBEDDED_ENCODED}`,
			);
		});

		it("404s the same URL carried in the path — the collapse makes it a different row, which must not be silently recrawled", async () => {
			const harness = await seedEmbeddedArticle();
			const agent = await loginAs(harness.server, ADMIN_EMAIL, ADMIN_PASSWORD);

			// supertest sends the path verbatim; the collapsed form is what the
			// edge would deliver in production.
			const response = await agent.post(
				"/admin/recrawl/https://web.archive.org/web/20260707152150im_/https:/www.tampabay.com/a.jpg?auth=abc",
			);

			expect(response.status).toBe(404);
			expect(harness.recrawlPublishedCalls).toEqual([]);
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
			const doc = new JSDOM(response.text).window.document;
			const pollUrl = doc.querySelector("[hx-get]")?.getAttribute("hx-get");
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
			const doc = new JSDOM(response.text).window.document;
			const pollUrl = doc.querySelector("[hx-get]")?.getAttribute("hx-get");
			expect(pollUrl).toContain("/admin/recrawl/reader");
			expect(pollUrl).toContain(encodeURIComponent(ARTICLE_URL));
		});
	});
});
