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
import { MAX_POLLS } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { viewPathFor } from "../view/view-path";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/target-post";
const RELATED_ID = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const FINISHED_RELATED_ID = ReaderArticleHashIdSchema.parse(
	"fedcba9876543210fedcba9876543210",
);

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
				{
					id: RELATED_ID,
					title: "Earlier read",
					siteName: "Example",
					reason: "Same argument",
					status: "unread",
				},
				{
					id: FINISHED_RELATED_ID,
					title: "Already finished",
					siteName: "Example",
					reason: "Follow-up",
					status: "read",
				},
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

		const states = Array.from(doc.querySelectorAll("[data-test-related-item]")).map(
			(item) => {
				const badge = item.querySelector(".related-slot__status");
				assert(badge, "every relation shows whether the reader has read it");
				const label = badge.querySelector(".related-slot__status-label");
				assert(label, "a read state names itself in words, not only by its shape");
				return {
					id: item.getAttribute("data-test-related-item"),
					state: badge.getAttribute("data-test-read-status"),
					unread: badge.classList.contains("related-slot__status--unread"),
					read: badge.classList.contains("related-slot__status--read"),
					label: label.textContent,
				};
			},
		);
		expect(states).toEqual([
			{
				id: RELATED_ID.value,
				state: "unread",
				unread: true,
				read: false,
				label: "Unread",
			},
			{
				id: FINISHED_RELATED_ID.value,
				state: "read",
				unread: false,
				read: true,
				label: "Read",
			},
		]);
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

	it("ticks the slot while the computation is still running", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view?feature=similar`);

		expect(relatedSlotOf(response.text).getAttribute("hx-get")).toBe(
			`/queue/${articleId}/related?feature=similar&poll=1`,
		);
	});

	it("never ticks the slot without the feature toggle", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(relatedSlotOf(response.text).hasAttribute("hx-get")).toBe(false);
	});

	it("never ticks the slot when the relations are already there", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view?feature=similar`);

		expect(relatedSlotOf(response.text).hasAttribute("hx-get")).toBe(false);
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

describe("GET /queue/:id/related", () => {
	it("404s without the feature toggle, so the gate cannot be walked around", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/related?poll=1`);

		expect(response.status).toBe(404);
	});

	it("404s for an id that is not an article id at all", async () => {
		const { agent } = await buildHarness();

		const response = await agent.get("/queue/not-an-article-id/related?feature=similar&poll=1");

		expect(response.status).toBe(404);
	});

	it("404s for an article this reader has not saved", async () => {
		const { agent } = await buildHarness();

		const response = await agent.get(
			`/queue/${RELATED_ID.value}/related?feature=similar&poll=1`,
		);

		expect(response.status).toBe(404);
	});

	it("answers with the hidden slot and the next tick while still computing", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/related?feature=similar&poll=1`);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
		expect(slot.getAttribute("hx-get")).toBe(
			`/queue/${articleId}/related?feature=similar&poll=2`,
		);
	});

	it("answers with the relations and stops the chain once they are computed", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/related?feature=similar&poll=1`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("ready");
		expect(slot.classList.contains("article-body__related-slot--visible")).toBe(true);
		expect(slot.hasAttribute("hx-get")).toBe(false);
		const link = doc.querySelector(`[data-test-related-item="${RELATED_ID.value}"]`);
		assert(link, "a ready poll response must render the relation link");
		expect(link.getAttribute("href")).toBe(
			`/queue/${RELATED_ID.value}/view?utm_source=reader&utm_medium=internal&utm_content=related&utm_term=${articleId}`,
		);
	});

	it("stops the chain once the poll budget is spent, even while still computing", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(
			`/queue/${articleId}/related?feature=similar&poll=${MAX_POLLS}`,
		);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.hasAttribute("hx-get")).toBe(false);
	});
});
