import assert from "node:assert/strict";
import { initReadabilityParser } from "@packages/article-parser";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createNoopLogError,
} from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { viewPathFor } from "../view/view-path";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/target-post";
const RELATED_ID = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");

const ARTICLE_HTML = `
<html><head><title>Target Post</title></head>
<body><article>
	<h1>Target Post</h1>
	<p>This is archived content that should survive the original site going down. Enough text for readability.</p>
	<p>A second paragraph with more words for the parser to work with properly.</p>
</article></body></html>`;

async function buildHarness() {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html: ARTICLE_HTML,
		bodyHash: "a".repeat(64),
	});
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
	const harness = useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
		},
	});
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });

	const queueResponse = await agent.get("/queue");
	const articleId = new JSDOM(queueResponse.text).window.document
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(articleId, "the saved article must appear in the queue");

	const signedInUser = await fixture.auth.findUserByEmail("test@example.com");
	assert(signedInUser, "loginAgent creates the user it signs in as");
	const { userId } = signedInUser;

	async function seedRelated(): Promise<void> {
		await fixture.relatedArticles.seedRelatedArticles({
			userId,
			url: ARTICLE_URL,
			items: [
				{ id: RELATED_ID, title: "Earlier read", siteName: "Example", reason: "Same argument" },
			],
		});
	}

	return { fixture, harness, agent, articleId, seedRelated };
}

function relatedSlotOf(html: string) {
	const slot = new JSDOM(html).window.document.querySelector(
		"[data-test-reader-related]",
	);
	assert(slot, "the reader always renders the related slot");
	return slot;
}

describe("Reader related-articles slot", () => {
	it("stays hidden without the feature toggle, even once relations exist", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view`);

		const slot = relatedSlotOf(response.text);
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("shows the relations when the reader opts into the feature", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view?feature=similar`);

		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-reader-related]");
		assert(slot, "the reader always renders the related slot");
		expect(slot.classList.contains("article-body__related-slot--visible")).toBe(true);
		const link = doc.querySelector(`[data-test-related-item="${RELATED_ID.value}"]`);
		assert(link, "the seeded relation must render a link");
		const href = link.getAttribute("href");
		assert(href, "a relation link must navigate somewhere");
		const [path, query] = href.split("?");
		expect(path).toBe(`/queue/${RELATED_ID.value}/view`);
		expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
			utm_source: "reader",
			utm_medium: "internal",
			utm_content: "related",
			utm_term: articleId,
		});
		expect(link.querySelector(".related-slot__reason")?.textContent).toBe("Same argument");
	});

	it("stays hidden with the toggle on while nothing has been computed", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view?feature=similar`);

		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("never renders another reader's relations on the public view", async () => {
		const { harness, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await request(harness.server).get(
			`${viewPathFor(ARTICLE_URL)}?feature=similar`,
		);

		const slot = relatedSlotOf(response.text);
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("degrades to the hidden slot when the relations cannot be read", async () => {
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: ARTICLE_HTML,
			bodyHash: "a".repeat(64),
		});
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
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle },
			events: {
				...fixture.events,
				publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			},
			relatedArticles: {
				...fixture.relatedArticles,
				findRelatedArticles: async () => {
					throw new Error("related store unavailable");
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });
		const queueResponse = await agent.get("/queue");
		const articleId = new JSDOM(queueResponse.text).window.document
			.querySelector("[data-test-article-list] .queue-article")
			?.getAttribute("data-test-article");
		assert(articleId, "the saved article must appear in the queue");

		const response = await agent.get(`/queue/${articleId}/view?feature=similar`);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});
});
