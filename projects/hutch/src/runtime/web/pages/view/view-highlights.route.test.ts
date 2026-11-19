import assert from "node:assert/strict";
import { calculateReadTime } from "@packages/domain/article";
import type { ParseArticle } from "@packages/article-parser";
import {
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishSaveAnonymousLink,
	TEST_APP_ORIGIN,
	type TestAppFixture,
} from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, loginAgent, type TestAppHarness, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const useMeteredApp = useTestServer({ isDailyLimited: () => true });

const DAY_MS = 24 * 60 * 60 * 1000;
const ARTICLE_URL = "https://example.com/post";
const ARTICLE_HTML =
	"<p>The first paragraph opens the article. A second sentence follows it.</p><p>The first paragraph is quoted again here.</p>";
const CLAIM_PATH = "/view/highlights/claim";

interface KeptItem {
	url: string;
	exact: string;
	prefix: string;
	suffix: string;
	note?: string;
}

const SECOND_SENTENCE: KeptItem = {
	url: ARTICLE_URL,
	exact: "A second sentence",
	prefix: "paragraph opens the article. ",
	suffix: " follows it.",
	note: "Worth keeping",
};

async function seedArticle(fixture: TestAppFixture): Promise<void> {
	await fixture.articleStore.saveArticleGlobally({
		url: ARTICLE_URL,
		metadata: { title: "A readable post", siteName: "Example", excerpt: "An excerpt.", wordCount: 20 },
		estimatedReadTime: calculateReadTime(20),
		savedAt: new Date("2026-11-01T00:00:00.000Z"),
	});
	await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: ARTICLE_HTML });
	await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
}

async function harnessWithArticle(
	fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN),
	serve: typeof useApp = useApp,
): Promise<TestAppHarness> {
	const parseArticle: ParseArticle = async () => ({
		ok: true,
		article: { title: "A readable post", siteName: "Example", excerpt: "An excerpt.", wordCount: 20, content: ARTICLE_HTML },
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	const harness = serve({
		...fixture,
		parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	});
	await seedArticle(fixture);
	return harness;
}

function keepBody(input: {
	items: readonly KeptItem[];
	intent?: "signup" | "login";
	article?: string;
	returnTo?: string;
}) {
	return {
		highlights: JSON.stringify(input.items),
		article: input.article ?? ARTICLE_URL,
		intent: input.intent ?? "signup",
		return: input.returnTo ?? "",
	};
}

async function keep(input: { agent: ReturnType<typeof request.agent>; items: readonly KeptItem[]; returnTo?: string }) {
	return input.agent
		.post("/view/highlights/keep")
		.set(BROWSER_REQUEST_HEADERS)
		.type("form")
		.send(keepBody({ items: input.items, returnTo: input.returnTo }));
}

async function signUp(agent: ReturnType<typeof request.agent>) {
	return agent
		.post(`/signup?return=${encodeURIComponent(CLAIM_PATH)}`)
		.set(BROWSER_REQUEST_HEADERS)
		.type("form")
		.send({ email: "new-reader@example.com", password: "password123", loadedAt: String(Date.now() - 5000) });
}

function pendingCookieOf(headers: Record<string, unknown>): string[] {
	const raw = headers["set-cookie"];
	const cookies = Array.isArray(raw) ? raw.map(String) : [];
	return cookies.filter((cookie) => cookie.startsWith("hutch_phid="));
}

function railRowsOf(html: string): { exact: string; note: string | undefined }[] {
	const doc = new JSDOM(html).window.document;
	return Array.from(doc.querySelectorAll("[data-test-highlight-row]"), (row) => ({
		exact: row.querySelector(".highlights-rail__excerpt")?.textContent ?? "",
		note: row.querySelector("[data-test-highlight-note]")?.textContent ?? undefined,
	}));
}

async function keepThenSignUpAndClaim(input: {
	harness: TestAppHarness;
	items: readonly KeptItem[];
	returnTo?: string;
}) {
	const agent = request.agent(input.harness.server);
	await keep({ agent, items: input.items, returnTo: input.returnTo });
	await signUp(agent);
	const claim = await agent.post(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS).type("form").send({});
	return { agent, claim };
}

describe("POST /view/highlights/keep", () => {
	it("holds the kept highlights for a day under a cookie and sends the visitor to sign up", async () => {
		const harness = await harnessWithArticle();

		const response = await keep({ agent: request.agent(harness.server), items: [SECOND_SENTENCE] });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/signup?return=%2Fview%2Fhighlights%2Fclaim");
		const [cookie] = pendingCookieOf(response.headers);
		assert(cookie, "the pending id rides an httpOnly cookie");
		expect(cookie).toMatch(/^hutch_phid=[0-9a-f-]{36};/);
		expect(cookie).toContain("Max-Age=86400");
		expect(cookie).toContain("HttpOnly");
		expect(
			harness.analytics.events.filter((event) => event.event === "view_highlights_handed_over"),
		).toEqual([expect.objectContaining({ intent: "signup", highlights: 1 })]);
	});

	it("sends a visitor who already has an account to log in", async () => {
		const harness = await harnessWithArticle();

		const response = await request(harness.server)
			.post("/view/highlights/keep")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send(keepBody({ items: [SECOND_SENTENCE], intent: "login" }));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Fview%2Fhighlights%2Fclaim");
	});

	it.each([
		["six highlights", keepBody({ items: Array.from({ length: 6 }, () => SECOND_SENTENCE) })],
		["a quote over the kept length", keepBody({ items: [{ ...SECOND_SENTENCE, exact: "x".repeat(1001) }] })],
		["an article that is not a link", keepBody({ items: [SECOND_SENTENCE], article: "not a url" })],
		["a highlight of a link that is not one", keepBody({ items: [{ ...SECOND_SENTENCE, url: "javascript:alert(1)" }] })],
		["highlights that are not JSON", { highlights: "{nope", article: ARTICLE_URL, intent: "signup" }],
	])("refuses %s and holds nothing", async (_case, body) => {
		const harness = await harnessWithArticle();

		const response = await request(harness.server)
			.post("/view/highlights/keep")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send(body);

		expect(response.status).toBe(400);
		expect(pendingCookieOf(response.headers)).toEqual([]);
	});

	it("holds nothing for a signed-in reader, who already highlights in the reader", async () => {
		const harness = await harnessWithArticle();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/view/highlights/keep")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send(keepBody({ items: [SECOND_SENTENCE] }));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		expect(pendingCookieOf(response.headers)).toEqual([]);
	});
});

describe("POST /view/highlights/event", () => {
	it.each([
		["action=kept", "kept"],
		["action=limit-reached", "limit_reached"],
		["highlight=local-1&origin=mark", "opened"],
	])("records %s for a logged-out visitor, with no quote text", async (query, action) => {
		const harness = await harnessWithArticle();

		const response = await request(harness.server).post(`/view/highlights/event?${query}`).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(204);
		const recorded = harness.analytics.events.filter((event) => event.event === "view_highlight");
		expect(recorded).toEqual([
			{
				stream: "analytics",
				event: "view_highlight",
				timestamp: expect.any(String),
				action,
				visitor_hash: expect.any(String),
				visitor_id: expect.any(String),
			},
		]);
	});

	it("answers an unknown beacon without recording it", async () => {
		const harness = await harnessWithArticle();

		const response = await request(harness.server).post("/view/highlights/event?action=other").set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(204);
		expect(harness.analytics.events.filter((event) => event.event === "view_highlight")).toEqual([]);
	});
});

describe("/view/highlights/claim", () => {
	it("renders a self-posting form on GET and writes nothing", async () => {
		const harness = await harnessWithArticle();
		const agent = request.agent(harness.server);
		await keep({ agent, items: [SECOND_SENTENCE] });
		await signUp(agent);

		const page = await agent.get(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(page.status).toBe(200);
		const form = new JSDOM(page.text).window.document.querySelector("[data-test-form='view-highlights-claim']");
		assert(form, "the claim page renders its form");
		expect([form.getAttribute("method"), form.getAttribute("action"), form.hasAttribute("data-auto-submit")]).toEqual([
			"POST",
			CLAIM_PATH,
			true,
		]);
		const queue = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);
		const empty = new JSDOM(queue.text).window.document.querySelector("[data-test-empty-readlist]");
		assert(empty, "the readlist is still empty after the GET");
	});

	it("saves the article, creates the highlights and lands on the reader's rail", async () => {
		const harness = await harnessWithArticle();

		const { agent, claim } = await keepThenSignUpAndClaim({ harness, items: [SECOND_SENTENCE] });

		expect(claim.status).toBe(303);
		expect(claim.headers.location).toMatch(/^\/queue\/[^/]+\/view#highlights-rail$/);
		const reader = await agent.get(claim.headers.location).set(BROWSER_REQUEST_HEADERS);
		expect(railRowsOf(reader.text)).toEqual([{ exact: "A second sentence", note: "Worth keeping" }]);
		expect(harness.analytics.events.filter((event) => event.event === "view_highlights_claimed")).toEqual([
			expect.objectContaining({ created: 1, dropped: 0 }),
		]);
	});

	it("returns to the Save the visitor tapped once the highlights are claimed, and that save lands the article", async () => {
		const harness = await harnessWithArticle();
		const save = `/save?url=${encodeURIComponent(ARTICLE_URL)}`;

		const { agent, claim } = await keepThenSignUpAndClaim({ harness, items: [SECOND_SENTENCE], returnTo: save });

		expect([claim.status, claim.headers.location]).toEqual([303, save]);
		const saved = await agent.get(save).set(BROWSER_REQUEST_HEADERS);
		expect(saved.headers.location).toBe(`/queue?url=${encodeURIComponent(ARTICLE_URL)}`);
		expect(harness.analytics.events.filter((event) => event.event === "view_highlights_claimed")).toEqual([
			expect.objectContaining({ created: 1, dropped: 0 }),
		]);
	});

	it("ignores a page to return to that leaves the site", async () => {
		const harness = await harnessWithArticle();

		const { claim } = await keepThenSignUpAndClaim({
			harness,
			items: [SECOND_SENTENCE],
			returnTo: "//evil.example/save",
		});

		expect(claim.headers.location).toMatch(/^\/queue\/[^/]+\/view#highlights-rail$/);
	});

	it("claims the kept highlights once", async () => {
		const harness = await harnessWithArticle();
		const { agent, claim } = await keepThenSignUpAndClaim({ harness, items: [SECOND_SENTENCE] });

		const again = await agent.post(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS).type("form").send({});

		expect(again.status).toBe(303);
		expect(again.headers.location).toBe("/queue");
		const reader = await agent.get(claim.headers.location).set(BROWSER_REQUEST_HEADERS);
		expect(railRowsOf(reader.text)).toHaveLength(1);
	});

	it("drops a quote that is no longer in the article and keeps the others", async () => {
		const harness = await harnessWithArticle();

		const { agent, claim } = await keepThenSignUpAndClaim({
			harness,
			items: [SECOND_SENTENCE, { url: ARTICLE_URL, exact: "A sentence that was edited out", prefix: "", suffix: "" }],
		});

		const reader = await agent.get(claim.headers.location).set(BROWSER_REQUEST_HEADERS);
		expect(railRowsOf(reader.text).map((row) => row.exact)).toEqual(["A second sentence"]);
		expect(harness.analytics.events.filter((event) => event.event === "view_highlights_claimed")).toEqual([
			expect.objectContaining({ created: 1, dropped: 1 }),
		]);
	});

	it("places a quote that occurs twice by the text before it, even when that text ends in a space", async () => {
		const harness = await harnessWithArticle();

		const { agent, claim } = await keepThenSignUpAndClaim({
			harness,
			items: [{ url: ARTICLE_URL, exact: "The first paragraph", prefix: "sentence follows it. ", suffix: " is quoted" }],
		});

		const reader = await agent.get(claim.headers.location).set(BROWSER_REQUEST_HEADERS);
		const marks = Array.from(
			new JSDOM(reader.text).window.document.querySelectorAll(".article-body__content mark[data-highlight-id]"),
			(mark) => mark.parentElement?.textContent,
		);
		expect(marks).toEqual(["The first paragraph is quoted again here."]);
	});

	it("keeps the highlights and the cookie when the claim fails partway, so a retry claims them", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const refresh = fixture.freshness.refreshArticleIfStale;
		let failRefresh = false;
		fixture.freshness.refreshArticleIfStale = async (input) => {
			if (failRefresh) throw new Error("throttled");
			return refresh(input);
		};
		const harness = await harnessWithArticle(fixture);
		const agent = request.agent(harness.server);
		await keep({ agent, items: [SECOND_SENTENCE] });
		await signUp(agent);
		failRefresh = true;

		const failed = await agent.post(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS).type("form").send({});
		failRefresh = false;
		const retry = await agent.post(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS).type("form").send({});

		expect([failed.status, pendingCookieOf(failed.headers)]).toEqual([500, []]);
		expect(retry.status).toBe(303);
		expect(retry.headers.location).toMatch(/^\/queue\/[^/]+\/view#highlights-rail$/);
		const reader = await agent.get(retry.headers.location).set(BROWSER_REQUEST_HEADERS);
		expect(railRowsOf(reader.text)).toEqual([{ exact: "A second sentence", note: "Worth keeping" }]);
	});

	it("sends a reader whose kept highlights are gone to their readlist", async () => {
		const harness = await harnessWithArticle();
		const agent = await loginAgent(harness.server, harness.auth);

		const claim = await agent
			.post(CLAIM_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.set("Cookie", "hutch_phid=6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f")
			.type("form")
			.send({});

		expect(claim.status).toBe(303);
		expect(claim.headers.location).toBe("/queue");
	});

	it("lands on the readlist when the article the visitor was reading cannot be saved", async () => {
		const harness = await harnessWithArticle();
		const privateUrl = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
		const agent = request.agent(harness.server);
		await agent
			.post("/view/highlights/keep")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send(keepBody({ items: [{ ...SECOND_SENTENCE, url: privateUrl }], article: privateUrl }));
		await signUp(agent);

		const claim = await agent.post(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS).type("form").send({});

		expect(claim.status).toBe(303);
		expect(claim.headers.location).toBe("/queue");
		expect(harness.analytics.events.filter((event) => event.event === "view_highlights_claimed")).toEqual([
			expect.objectContaining({ created: 0, dropped: 1 }),
		]);
	});

	it("refuses the claim once a free account's new saves for the day are spent, and keeps the highlights for later", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.rateLimit = {
			...fixture.rateLimit,
			rules: { ...fixture.rateLimit.rules, dailySaves: { limit: 0, windowSeconds: 86_400 } },
		};
		const harness = await harnessWithArticle(fixture, useMeteredApp);

		const { agent, claim } = await keepThenSignUpAndClaim({ harness, items: [SECOND_SENTENCE] });

		expect([claim.status, pendingCookieOf(claim.headers)]).toEqual([429, []]);
		expect(String(claim.headers["retry-after"])).toMatch(/^\d+$/);
		const page = new JSDOM(claim.text).window.document.querySelector("[data-test-view-daily-save-limit]");
		assert(page, "the daily-limit page must render");
		const queue = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);
		const empty = new JSDOM(queue.text).window.document.querySelector("[data-test-empty-readlist]");
		assert(empty, "nothing is saved past the day's allowance");
		expect(harness.analytics.events.filter((event) => event.event === "view_highlights_claimed")).toEqual([]);
	});

	it("refuses a locked account and keeps nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * DAY_MS);
		const harness = await harnessWithArticle(fixture);
		const anonymous = request.agent(harness.server);
		const kept = await keep({ agent: anonymous, items: [SECOND_SENTENCE] });
		const [cookie] = pendingCookieOf(kept.headers);
		assert(cookie, "keep sets the pending cookie");
		const agent = await loginAgent(harness.server, harness.auth);

		const claim = await agent
			.post(CLAIM_PATH)
			.set(BROWSER_REQUEST_HEADERS)
			.set("Cookie", cookie.split(";")[0])
			.type("form")
			.send({});

		expect(claim.status).toBe(403);
		expect(harness.analytics.events.filter((event) => event.event === "view_highlights_claimed")).toEqual([]);
	});

	it("sends a signed-out visitor to sign up first", async () => {
		const harness = await harnessWithArticle();

		const page = await request(harness.server).get(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(page.status).toBe(303);
		expect(page.headers.location).toBe("/signup?return=%2Fview%2Fhighlights%2Fclaim");
	});

	it("sends a reader with nothing kept to their readlist", async () => {
		const harness = await harnessWithArticle();
		const agent = await loginAgent(harness.server, harness.auth);

		const page = await agent.get(CLAIM_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(page.status).toBe(303);
		expect(page.headers.location).toBe("/queue");
	});
});
