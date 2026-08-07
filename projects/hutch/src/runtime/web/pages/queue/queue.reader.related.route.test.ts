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
const RELATED_URL = "https://example.com/earlier-post";
const FOLLOW_UP_URL = "https://example.com/follow-up-post";
const UNSAVED_ID = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const COMPUTED_AT = new Date("2026-06-05T12:00:00.000Z");

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
	[RELATED_URL, "Earlier read"],
	[FOLLOW_UP_URL, "Still to read"],
]);

async function buildHarness() {
	const crawlArticle = async ({ url }: { url: string }) => {
		const title = TITLES.get(url);
		assert(title, `the test only crawls urls it seeded a title for: ${url}`);
		return {
			status: "fetched" as const,
			html: articleHtml(title),
			bodyHash: "a".repeat(64),
		};
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
	const harness = useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
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
	const related = await save(RELATED_URL);
	const followUp = await save(FOLLOW_UP_URL);

	async function seedRelated(): Promise<void> {
		await fixture.relatedArticles.markRelatedArticlesReady({
			userId,
			url: ARTICLE_URL,
			relatedArticles: [
				{ url: RELATED_URL, reason: "Same argument" },
				{ url: FOLLOW_UP_URL, reason: "Follow-up" },
			],
			inputTokens: 0,
			outputTokens: 0,
			at: COMPUTED_AT,
		});
	}

	return {
		fixture,
		harness,
		agent,
		articleId: target.id.value,
		related,
		followUp,
		seedRelated,
	};
}

function relatedIdsOf(html: string): (string | null)[] {
	return Array.from(
		new JSDOM(html).window.document.querySelectorAll("[data-test-related-item]"),
	).map((item) => item.getAttribute("data-test-related-item"));
}

function relatedSlotOf(html: string) {
	const slot = new JSDOM(html).window.document.querySelector(
		"[data-test-reader-related]",
	);
	assert(slot, "the reader always renders the related slot");
	return slot;
}

describe("Reader related-articles slot", () => {
	it("floats the first unread relation", async () => {
		const { agent, articleId, related, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view`);

		const doc = new JSDOM(response.text).window.document;
		const slot = doc.querySelector("[data-test-reader-related]");
		assert(slot, "the reader always renders the next-read slot");
		expect(slot.classList.contains("next-read--ready")).toBe(true);
		const link = doc.querySelector(`[data-test-related-item="${related.id.value}"]`);
		assert(link, "the seeded relation must render a link");
		const href = link.getAttribute("href");
		assert(href, "a relation link must navigate somewhere");
		const [path, query] = href.split("?");
		expect(path).toBe(`/queue/${related.id.value}/view`);
		expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
			utm_source: "reader",
			utm_medium: "internal",
			utm_content: "related",
			utm_term: articleId,
		});
		expect(link.querySelector(".next-read__title")?.textContent).toBe("Earlier read");
		expect(link.querySelector(".next-read__reason")?.textContent).toBe("Same argument");
		const saved = link.querySelector(".next-read__saved time");
		assert(saved, "each relation must say when the reader saved it");
		expect({
			datetime: saved.getAttribute("datetime"),
			mode: saved.getAttribute("data-local-time"),
		}).toEqual({ datetime: related.savedAt.toISOString(), mode: "relative" });

		const badge = link.querySelector(".next-read__status");
		assert(badge, "the suggestion shows whether the reader has read it");
		const label = badge.querySelector(".next-read__status-label");
		assert(label, "a read state names itself in words, not only by its shape");
		expect({
			state: badge.getAttribute("data-test-read-status"),
			unread: badge.classList.contains("next-read__status--unread"),
			label: label.textContent,
		}).toEqual({ state: "unread", unread: true, label: "Unread" });
	});

	it("suggests only one article, so the reader is offered a single next read", async () => {
		const { agent, articleId, related, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(relatedIdsOf(response.text)).toEqual([related.id.value]);
	});

	it("drops a relation the reader marks read, and brings it back when they mark it unread", async () => {
		const { agent, articleId, related, followUp, seedRelated } = await buildHarness();
		await seedRelated();

		await agent
			.post(`/queue/${related.id.value}/status`)
			.type("form")
			.send({ status: "read" });
		const afterRead = await agent.get(`/queue/${articleId}/view`);

		await agent
			.post(`/queue/${related.id.value}/status`)
			.type("form")
			.send({ status: "unread" });
		const afterUnread = await agent.get(`/queue/${articleId}/view`);

		expect(relatedIdsOf(afterRead.text)).toEqual([followUp.id.value]);
		expect(relatedIdsOf(afterUnread.text)).toEqual([related.id.value]);
	});

	it("hides the card once the reader has read every relation", async () => {
		const { agent, articleId, related, followUp, seedRelated } = await buildHarness();
		await seedRelated();

		for (const id of [related.id.value, followUp.id.value]) {
			await agent.post(`/queue/${id}/status`).type("form").send({ status: "read" });
		}
		const response = await agent.get(`/queue/${articleId}/view`);

		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("ready");
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
		expect(relatedIdsOf(response.text)).toEqual([]);
	});

	it("drops a relation the reader deletes from their queue", async () => {
		const { agent, articleId, related, followUp, seedRelated } = await buildHarness();
		await seedRelated();

		await agent.post(`/queue/${related.id.value}/delete`);
		const response = await agent.get(`/queue/${articleId}/view`);

		expect(relatedIdsOf(response.text)).toEqual([followUp.id.value]);
	});

	it("stays hidden while nothing has been computed", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view`);

		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});

	it("never renders another reader's relations on the public view", async () => {
		const { harness, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await request(harness.server).get(viewPathFor(ARTICLE_URL));

		const doc = new JSDOM(response.text).window.document;
		assert(
			doc.querySelector("[data-article-body]"),
			"the public view still renders the article it was asked for",
		);
		expect(relatedIdsOf(response.text)).toEqual([]);
	});

	it("ticks the slot while the computation is still running", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(relatedSlotOf(response.text).getAttribute("hx-get")).toBe(
			`/queue/${articleId}/related?poll=1`,
		);
	});

	it("never ticks the slot when the relations are already there", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(relatedSlotOf(response.text).hasAttribute("hx-get")).toBe(false);
	});

	it("degrades to the hidden slot when the relations cannot be read", async () => {
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: articleHtml("Target Post"),
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

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
	});
});

describe("GET /queue/:id/related", () => {
	it("404s for an id that is not an article id at all", async () => {
		const { agent } = await buildHarness();

		const response = await agent.get("/queue/not-an-article-id/related?poll=1");

		expect(response.status).toBe(404);
	});

	it("404s for an article this reader has not saved", async () => {
		const { agent } = await buildHarness();

		const response = await agent.get(
			`/queue/${UNSAVED_ID.value}/related?poll=1`,
		);

		expect(response.status).toBe(404);
	});

	it("answers with the hidden slot and the next tick while still computing", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(`/queue/${articleId}/related?poll=1`);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
		expect(slot.getAttribute("hx-get")).toBe(
			`/queue/${articleId}/related?poll=2`,
		);
	});

	it("answers with the relations and stops the chain once they are computed", async () => {
		const { agent, articleId, related, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/related?poll=1`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("ready");
		expect(slot.classList.contains("next-read--ready")).toBe(true);
		expect(slot.hasAttribute("hx-get")).toBe(false);
		const link = doc.querySelector(`[data-test-related-item="${related.id.value}"]`);
		assert(link, "a ready poll response must render the relation link");
		expect(link.getAttribute("href")).toBe(
			`/queue/${related.id.value}/view?utm_source=reader&utm_medium=internal&utm_content=related&utm_term=${articleId}`,
		);
		const saved = link.querySelector(".next-read__saved time");
		assert(saved, "a ready poll response must carry the saved time too");
		expect({
			datetime: saved.getAttribute("datetime"),
			mode: saved.getAttribute("data-local-time"),
		}).toEqual({ datetime: related.savedAt.toISOString(), mode: "relative" });
	});

	it("stops the chain once the poll budget is spent, even while still computing", async () => {
		const { agent, articleId } = await buildHarness();

		const response = await agent.get(
			`/queue/${articleId}/related?poll=${MAX_POLLS}`,
		);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.hasAttribute("hx-get")).toBe(false);
	});
});

describe("POST /queue/:id/related-dismiss", () => {
	function dismissUrlOf(html: string): string {
		const form = new JSDOM(html).window.document.querySelector(
			".next-read__dismiss-form",
		);
		assert(form, "a floated suggestion must offer a way to dismiss it");
		const action = form.getAttribute("action");
		assert(action, "the dismiss form must post somewhere");
		return action;
	}

	it("counts the dismissal as a reader click, so it reaches the analytics dashboards", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent.get(`/queue/${articleId}/view`);

		const [path, query] = dismissUrlOf(response.text).split("?");
		expect(path).toBe(`/queue/${articleId}/related-dismiss`);
		expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
			utm_source: "reader",
			utm_medium: "internal",
			utm_content: "next-read-dismiss",
			utm_term: articleId,
		});
	});

	it("keeps the suggestion gone for that article once dismissed", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();
		const opened = await agent.get(`/queue/${articleId}/view`);

		const dismissal = await agent
			.post(dismissUrlOf(opened.text))
			.type("form")
			.send({ returnTo: `/queue/${articleId}/view` });
		const reopened = await agent.get(`/queue/${articleId}/view`);

		expect(dismissal.status).toBe(303);
		expect(dismissal.headers.location).toBe(`/queue/${articleId}/view`);
		const slot = relatedSlotOf(reopened.text);
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
		expect(relatedIdsOf(reopened.text)).toEqual([]);
	});

	it("leaves other articles free to suggest their own next read", async () => {
		const { agent, articleId, related, followUp, fixture, seedRelated } = await buildHarness();
		await seedRelated();
		await fixture.relatedArticles.markRelatedArticlesReady({
			userId: related.userId,
			url: RELATED_URL,
			relatedArticles: [{ url: FOLLOW_UP_URL, reason: "Same thread" }],
			inputTokens: 0,
			outputTokens: 0,
			at: COMPUTED_AT,
		});

		await agent
			.post(`/queue/${articleId}/related-dismiss`)
			.type("form")
			.send({ returnTo: `/queue/${articleId}/view` });
		const otherArticle = await agent.get(`/queue/${related.id.value}/view`);

		expect(relatedIdsOf(otherArticle.text)).toEqual([followUp.id.value]);
	});

	it("stops the poll chain for an article dismissed while a tick was in flight", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();
		await agent
			.post(`/queue/${articleId}/related-dismiss`)
			.type("form")
			.send({ returnTo: `/queue/${articleId}/view` });

		const response = await agent.get(`/queue/${articleId}/related?poll=1`);

		expect(response.status).toBe(200);
		const slot = relatedSlotOf(response.text);
		expect(slot.classList.contains("next-read--hidden")).toBe(true);
		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("sends the reader home rather than off-site when the return path is not ours", async () => {
		const { agent, articleId, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent
			.post(`/queue/${articleId}/related-dismiss`)
			.type("form")
			.send({ returnTo: "https://evil.example/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
	});

	it("never dead-ends on an id that is not an article id at all", async () => {
		const { agent } = await buildHarness();

		const response = await agent
			.post("/queue/not-an-article-id/related-dismiss")
			.type("form")
			.send({ returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("does not dismiss on behalf of a reader who never saved the article", async () => {
		const { agent, seedRelated } = await buildHarness();
		await seedRelated();

		const response = await agent
			.post(`/queue/${UNSAVED_ID.value}/related-dismiss`)
			.type("form")
			.send({ returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});
});
