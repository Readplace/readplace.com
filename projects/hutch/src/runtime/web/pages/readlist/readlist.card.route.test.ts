import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { MAX_POLLS } from "@packages/web-shell";

const useApp = useTestServer();

describe("Readlist routes", () => {
	describe("Readlist list auto-refresh (per-card polling)", () => {
		async function getFirstArticleId(agent: ReturnType<typeof request.agent>): Promise<string> {
			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const id = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(id, "first article must be rendered with data-test-article id");
			return id;
		}

		function createTerminalPipelineFixture() {
			const articleHtml = `<html><head><title>Terminal Post</title></head><body><article><h1>Terminal Post</h1><p>Body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Ready summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			return useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
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
				summary: {
					findGeneratedSummary,
					markSummaryPending: fixture.summary.markSummaryPending,
				},
			});
		}

		it("renders hx-get polling on the readlist list card while crawl is pending", async () => {
			// Default fixture leaves crawl in pending state — no fake publish wiring.
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/list-pending" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const card = doc.querySelector("[data-test-article-list] .readlist-article");
			assert(card, "card must be rendered");
			expect(card.getAttribute("hx-get")).toMatch(/^\/queue\/.+\/card\?poll=1$/);
			expect(card.getAttribute("hx-trigger")).toBe(
				"every 3s [!this.querySelector('details[open]')]",
			);
			expect(card.getAttribute("hx-target")).toBe("this");
			expect(card.getAttribute("hx-swap")).toBe("outerHTML");
			expect(card.getAttribute("data-card-status")).toBe("pending");
		});

		it("does not render hx-get on the readlist list card once both pipelines terminate", async () => {
			const harness = createTerminalPipelineFixture();
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/list-done" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const card = doc.querySelector("[data-test-article-list] .readlist-article");
			assert(card, "card must be rendered");
			expect(card.hasAttribute("hx-get")).toBe(false);
			expect(card.hasAttribute("hx-trigger")).toBe(false);
			expect(card.getAttribute("data-card-status")).toBe("terminal");
		});

		it("GET /queue/:id/card returns a single card fragment with the next-poll URL when pending", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-pending" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=3`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".readlist-article");
			assert(card, "card fragment must be rendered");
			expect(card.getAttribute("data-test-article")).toBe(articleId);
			expect(card.getAttribute("hx-get")).toMatch(/poll=4(?:&|$)/);
			expect(card.getAttribute("hx-trigger")).toBe(
				"every 3s [!this.querySelector('details[open]')]",
			);
		});

		it("GET /queue/:id/card stops polling once both pipelines terminate", async () => {
			const harness = createTerminalPipelineFixture();
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-done" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=3`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".readlist-article");
			assert(card, "card fragment must be rendered");
			expect(card.hasAttribute("hx-get")).toBe(false);
			expect(card.getAttribute("data-card-status")).toBe("terminal");
		});

		it("GET /queue/:id/card stops polling at MAX_POLLS even while still pending", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-cap" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=${MAX_POLLS}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".readlist-article");
			assert(card, "card fragment must be rendered");
			expect(card.hasAttribute("hx-get")).toBe(false);
		});

		it("treats a non-numeric poll cursor as the start of the budget instead of polling unbounded", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-poll-nan" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=not-a-number`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".readlist-article");
			assert(card, "card fragment must be rendered");
			expect(card.getAttribute("hx-get")).toMatch(/[?&]poll=1(?:&|$)/);
			expect(card.getAttribute("data-card-status")).toBe("pending");
		});

		it("GET /queue/:id/card returns 404 for an unknown article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/00000000000000000000000000000000/card");
			expect(response.status).toBe(404);
		});

		it("GET /queue/:id/card sets ETag and revalidation cache directives", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-etag" });
			const articleId = await getFirstArticleId(agent);

			const response = await agent.get(`/queue/${articleId}/card?poll=1`);
			expect(response.status).toBe(200);
			const etag = response.headers.etag;
			assert(etag, "ETag header must be set");
			expect(etag.startsWith('W/"')).toBe(true);
			expect(response.headers["cache-control"]).toBe("private, no-cache");
			expect(response.headers.vary).toContain("Cookie");
		});

		it("GET /queue/:id/card returns 304 when If-None-Match matches the current ETag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-etag-304" });
			const articleId = await getFirstArticleId(agent);

			const first = await agent.get(`/queue/${articleId}/card?poll=1`);
			const etag = first.headers.etag;
			assert(etag, "first response must carry an ETag");

			const revalidate = await agent
				.get(`/queue/${articleId}/card?poll=2`)
				.set("If-None-Match", etag);
			expect(revalidate.status).toBe(304);
			expect(revalidate.text).toBe("");
			expect(revalidate.headers.etag).toBe(etag);
		});

		it("GET /queue/:id/card returns 200 with a new ETag when If-None-Match does not match", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-etag-200" });
			const articleId = await getFirstArticleId(agent);

			const response = await agent
				.get(`/queue/${articleId}/card?poll=1`)
				.set("If-None-Match", 'W/"stale-tag"');
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".readlist-article");
			assert(card, "card fragment must be rendered when ETag does not match");
		});

		it("GET /queue/:id/card preserves filter context (tab/order/page) on the next-poll URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-filter" });
			const articleId = await getFirstArticleId(agent);

			const response = await agent.get(`/queue/${articleId}/card?poll=2&tab=done&order=asc`);
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".readlist-article");
			assert(card, "card must be rendered");
			const next = card.getAttribute("hx-get");
			assert(next, "non-terminal card must carry an hx-get");
			expect(next).toContain("poll=3");
			expect(next).toContain("tab=done");
		});
	});
});

describe("GET /queue/:id/card — the move item", () => {
	type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

	function parse(html: string): Document {
		return new JSDOM(html).window.document;
	}

	async function createReadlist(agent: TestAgent, label: string): Promise<string> {
		const response = await agent.post("/queue/queues").type("form").send({ label });
		const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug, "creating a readlist must land the reader on it");
		return slug;
	}

	async function saveArticle(agent: TestAgent, url: string): Promise<string> {
		await agent.post("/queue/save").type("form").send({ url });
		const card = Array.from(parse((await agent.get("/queue")).text).querySelectorAll("[data-test-article]")).find(
			(el) => el.querySelector("[data-test-article-url]")?.getAttribute("href") === url,
		);
		const id = card?.getAttribute("data-test-article");
		assert(id, `the card for ${url} must render`);
		return id;
	}

	async function fileInto(agent: TestAgent, input: { articleId: string; readlist: string }): Promise<void> {
		const response = await agent
			.post(`/queue/${input.articleId}/assign`)
			.type("form")
			.send({ queue: input.readlist, returnTo: "/queue" });
		expect(response.status).toBe(303);
	}

	function moveItem(doc: Document): { opens: string | null; label: string | null } {
		const trigger = doc.querySelector('[data-test-article-menu] [data-test-action="move"]');
		assert(trigger, "the card must offer a move");
		return { opens: trigger.getAttribute("popovertarget"), label: trigger.textContent };
	}

	function menuControls(doc: Document): (string | null)[] {
		return Array.from(doc.querySelectorAll("[data-test-article-menu] .menu__panel [data-test-action]"), (control) =>
			control.getAttribute("data-test-action"),
		);
	}

	it("renders the listing's move item, in the custom and the All wording, without a dialog of its own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const weekend = await createReadlist(agent, "Weekend");
		await createReadlist(agent, "Finance");
		const articleId = await saveArticle(agent, "https://example.com/polled");
		await fileInto(agent, { articleId, readlist: weekend });

		const onWeekend = parse((await agent.get(`/queue?queue=${weekend}`)).text);
		const onAll = parse((await agent.get("/queue")).text);
		const polledOnWeekend = parse((await agent.get(`/queue/${articleId}/card?queue=${weekend}&poll=2`)).text);
		const polledOnAll = parse((await agent.get(`/queue/${articleId}/card?poll=2`)).text);

		expect(moveItem(polledOnWeekend)).toEqual(moveItem(onWeekend));
		expect(moveItem(polledOnAll)).toEqual(moveItem(onAll));
		expect([moveItem(polledOnWeekend).label, moveItem(polledOnAll).label]).toEqual([
			"Move to readlist",
			"Add to readlist",
		]);
		expect(
			polledOnWeekend.querySelectorAll(
				'[data-test-confirm-popover="move"], [data-test-confirm-popover="readlist-create-move"]',
			),
		).toHaveLength(0);
	});

	it("renders no move item for a read-only account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "Finance");
		const articleId = await saveArticle(agent, "https://example.com/polled-read-only");
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the signed-in reader must exist");
		await harness.subscriptionProviders.upsertActive({
			userId: user.userId,
			subscriptionId: "sub_card",
			customerId: "cus_card",
		});
		await harness.subscriptionProviders.markCancelledByUserId({ userId: user.userId });

		const polled = parse((await agent.get(`/queue/${articleId}/card?poll=2`)).text);

		expect(menuControls(polled)).toEqual(["delete-fallback", "delete"]);
	});

	it("builds the move item from the memberships the article holds now", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const finance = await createReadlist(agent, "Finance");
		const articleId = await saveArticle(agent, "https://example.com/polled-fresh");
		const listed = moveItem(parse((await agent.get("/queue")).text));
		await fileInto(agent, { articleId, readlist: finance });

		const polled = parse((await agent.get(`/queue/${articleId}/card?poll=2`)).text);

		expect([listed.opens, moveItem(polled).opens]).toEqual([
			`readlist-move-${articleId}`,
			`readlist-create-move-${articleId}`,
		]);
		expect(menuControls(polled)).toEqual(["move", "delete-fallback", "delete"]);
	});
});
