import assert from "node:assert/strict";
import { initReadabilityParser } from "@packages/article-parser";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createNoopLogError,
} from "@packages/test-fixtures";
import type { FindPastReads } from "@packages/provider-contracts/related-articles";
import { MAX_POLLS } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/target-post";
const PAST_URL = "https://example.com/earlier-post";
const UNSAVED_ID = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const COMPUTED_AT = new Date("2026-09-12T12:00:00.000Z");

function articleHtml(title: string): string {
	return `
<html><head><title>${title}</title></head>
<body><article>
	<h1>${title}</h1>
	<p>This is archived content that should survive the original site going down. Enough text for readability.</p>
	<p>A second paragraph with more words for the parser to work with properly.</p>
</article></body></html>`;
}

const TITLES = new Map([
	[ARTICLE_URL, "Target Post"],
	[PAST_URL, "Earlier read"],
]);

async function buildHarness(options: { findPastReads?: FindPastReads } = {}) {
	const crawlArticle = async ({ url }: { url: string }) => {
		const title = TITLES.get(url);
		assert(title, `the test only crawls urls it seeded a title for: ${url}`);
		return { status: "fetched" as const, html: articleHtml(title), bodyHash: "a".repeat(64) };
	};
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		siteRules: [],
		logError: createNoopLogError(),
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	const publishedComputeRequests: { url: string; readlist?: string }[] = [];
	const harness = useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishComputeRelatedPastReads: async (params) => {
				publishedComputeRequests.push({
					url: params.url,
					...(params.readlist !== undefined ? { readlist: params.readlist } : {}),
				});
			},
		},
		pastReads: {
			...fixture.pastReads,
			...(options.findPastReads ? { findPastReads: options.findPastReads } : {}),
		},
	});
	const agent = await loginAgent(harness.server, harness.auth);

	const signedInUser = await fixture.auth.findUserByEmail("test@example.com");
	assert(signedInUser, "loginAgent creates the user it signs in as");
	const { userId } = signedInUser;

	async function save(url: string) {
		await agent.post("/queue/save").type("form").send({ url });
		const article = await fixture.articleStore.findArticleByUrl(url);
		assert(article, `saving ${url} must create an article row`);
		const saved = await fixture.articleStore.findArticleById(article.id, userId);
		assert(saved, `saving ${url} must attach the article to the signed-in reader`);
		return saved;
	}

	const target = await save(ARTICLE_URL);
	const past = await save(PAST_URL);
	await fixture.articleStore.updateArticleStatus(past.id, userId, "read");

	async function seedPastReads(readlist?: string): Promise<void> {
		await fixture.pastReads.markPastReadsReady({
			userId,
			url: ARTICLE_URL,
			pastReads: [
				{
					url: PAST_URL,
					reason: "Same specific subject",
					...(readlist ? { readlist: ReadlistSlugSchema.parse(readlist) } : {}),
				},
			],
			fingerprint: "fp",
			inputTokens: 0,
			outputTokens: 0,
			at: COMPUTED_AT,
		});
	}

	return {
		fixture,
		harness,
		agent,
		userId,
		articleId: target.id.value,
		past,
		seedPastReads,
		publishedComputeRequests,
	};
}

function slotOf(html: string) {
	const slot = new JSDOM(html).window.document.querySelector("[data-test-reader-topic-reads]");
	assert(slot, "the reader always renders the topic-reads slot");
	return slot;
}

describe("Reader previously-read-on-this-topic slot", () => {
	it("renders a hidden, polling slot with a compute trigger while nothing is computed", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view`);

		const slot = slotOf(response.text);
		expect(slot.getAttribute("data-topic-reads-status")).toBe("pending");
		expect(slot.classList.contains("past-reads--hidden")).toBe(true);
		expect(slot.getAttribute("hx-get")).toContain(`/queue/${articleId}/topic-reads?poll=`);
		expect(slot.querySelector("form.past-reads__request")?.getAttribute("hx-post")).toContain(
			`/queue/${articleId}/topic-reads`,
		);
	});

	it("shows a computed match and opens it in its owned reading list", async () => {
		const { agent, articleId, past, seedPastReads } = await buildHarness();
		await seedPastReads("work");

		const response = await agent.get(`/queue/${articleId}/topic-reads?poll=1`);

		const doc = new JSDOM(response.text).window.document;
		const row = doc.querySelector(`[data-test-topic-read-item="${past.id.value}"]`);
		assert(row, "the computed match renders a row");
		expect(row.querySelector(".past-reads__title")?.textContent).toBe("Earlier read");
		expect(row.querySelector(".past-reads__reason")?.textContent).toBe("Same specific subject");
		const href = row.getAttribute("href") ?? "";
		expect(href).toContain(`/queue/${past.id.value}/view`);
		expect(href).toContain("queue=work");
		expect(href).toContain("utm_content=topic-read");
	});

	it("advances the poll cursor until the budget is spent", async () => {
		const { agent, articleId } = await buildHarness();

		const first = await agent.get(`/queue/${articleId}/topic-reads?poll=1`);
		expect(slotOf(first.text).getAttribute("hx-get")).toContain("poll=2");

		const last = await agent.get(`/queue/${articleId}/topic-reads?poll=${MAX_POLLS}`);
		expect(slotOf(last.text).getAttribute("hx-get")).toBe(null);
	});

	it("answers 404 for an article the reader has not saved", async () => {
		const { agent } = await buildHarness();

		const response = await agent.get(`/queue/${UNSAVED_ID.value}/topic-reads?poll=1`);

		expect(response.status).toBe(404);
	});

	it("requests computation on an htmx POST and answers 204", async () => {
		const { agent, articleId, publishedComputeRequests } = await buildHarness();

		const response = await agent
			.post(`/queue/${articleId}/topic-reads`)
			.set("HX-Request", "true");

		expect(response.status).toBe(204);
		expect(publishedComputeRequests).toEqual([{ url: ARTICLE_URL }]);
	});

	it("requests computation carrying the source reading list from a no-JS submit, redirecting back", async () => {
		const { agent, articleId, publishedComputeRequests } = await buildHarness();

		const response = await agent.post(`/queue/${articleId}/topic-reads?queue=work`);

		expect(response.status).toBe(303);
		expect(response.headers.location).toContain(`/queue/${articleId}/view`);
		expect(publishedComputeRequests).toEqual([{ url: ARTICLE_URL, readlist: "work" }]);
	});

	it("never requests computation for an article the reader has not saved", async () => {
		const { agent, publishedComputeRequests } = await buildHarness();

		const response = await agent
			.post(`/queue/${UNSAVED_ID.value}/topic-reads`)
			.set("HX-Request", "true");

		expect(response.status).toBe(204);
		expect(publishedComputeRequests).toEqual([]);
	});

	it("falls back to pending when the selection cannot be loaded", async () => {
		const { agent, articleId } = await buildHarness({
			findPastReads: async () => {
				throw new Error("store unavailable");
			},
		});

		const response = await agent.get(`/queue/${articleId}/topic-reads?poll=1`);

		expect(slotOf(response.text).getAttribute("data-topic-reads-status")).toBe("pending");
	});

	it("renders the section on the app surface too", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view?platform=ios`);

		expect(new JSDOM(response.text).window.document.querySelector("[data-test-reader-topic-reads]")).not.toBeNull();
	});
});
