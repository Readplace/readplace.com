import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initReadabilityParser } from "@packages/article-parser";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createNoopLogError,
} from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const PENDING_CRAWL_URL = "https://example.com/next-read-growing-post";
const RELATED_URL = "https://example.com/next-read-earlier-post";
const COMPUTED_AT = new Date("2026-06-05T12:00:00.000Z");

const CARD = "[data-test-reader-related]";
const READER_SLOT = "#article-body-reader-slot";

const NEXT_READ_BUNDLE = readFileSync(
	join(__dirname, "..", "..", "client-dist", "next-read.client.js"),
	"utf-8",
);

const CRAWLED_BODY =
	"<p>The crawl worker finally delivered the whole article, which stands many screens taller than the placeholder it replaced.</p>";

function articleHtml(title: string): string {
	return `
<html><head><title>${title}</title></head>
<body><article>
	<h1>${title}</h1>
	<p>This is archived content that should survive the original site going down. Enough text for readability.</p>
	<p>A second paragraph with more words for the parser to work with properly.</p>
</article></body></html>`;
}

async function buildPendingReaderWithSuggestion() {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html: articleHtml("Earlier read"),
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
			publishLinkSaved: createFakePublishLinkSaved(async (url) => {
				if (url === PENDING_CRAWL_URL) return;
				await applyParseResult(url);
			}),
		},
	});
	const agent = await loginAgent(harness.server, harness.auth);

	const signedInUser = await fixture.auth.findUserByEmail("test@example.com");
	assert(signedInUser, "loginAgent creates the user it signs in as");
	const { userId } = signedInUser;

	await agent.post("/queue/save").type("form").send({ url: RELATED_URL });
	await agent.post("/queue/save").type("form").send({ url: PENDING_CRAWL_URL });

	const source = await fixture.articleStore.findArticleByUrl(PENDING_CRAWL_URL);
	assert(source, "saving the source url must create an article row");

	await fixture.relatedArticles.markRelatedArticlesReady({
		userId,
		url: PENDING_CRAWL_URL,
		relatedArticles: [{ url: RELATED_URL, reason: "Same argument, earlier" }],
		inputTokens: 0,
		outputTokens: 0,
		at: COMPUTED_AT,
	});

	return { fixture, agent, articleId: source.id.value };
}

function cardOf(dom: JSDOM): Element {
	const card = dom.window.document.querySelector(CARD);
	assert(card, "the reader always renders the next-read slot");
	return card;
}

function putArticleEndAt(dom: JSDOM, bottom: number): void {
	const article = dom.window.document.querySelector("[data-article-body]");
	assert(article, "the reader always renders an article body");
	article.getBoundingClientRect = () => ({
		top: 0,
		bottom,
		left: 0,
		right: 0,
		width: 0,
		height: bottom,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
}

describe("Reader next-read card — the article growing under the reader", () => {
	it("gets the suggestion out of the way when the crawl poll grows the article body", async () => {
		const { fixture, agent, articleId } = await buildPendingReaderWithSuggestion();

		const view = await agent.get(`/queue/${articleId}/view`);
		expect(view.status).toBe(200);
		const dom = new JSDOM(view.text, {
			runScripts: "dangerously",
			beforeParse(window) {
				Object.assign(window, { htmx: { config: {} } });
			},
		});
		expect(cardOf(dom).classList.contains("next-read--ready")).toBe(true);

		const fold = dom.window.innerHeight;
		putArticleEndAt(dom, fold * 4);
		const bundle = dom.window.document.createElement("script");
		bundle.textContent = NEXT_READ_BUNDLE;
		dom.window.document.body.appendChild(bundle);
		expect(cardOf(dom).classList.contains("next-read--open")).toBe(false);

		putArticleEndAt(dom, fold - 20);
		dom.window.dispatchEvent(new dom.window.Event("scroll"));
		expect(cardOf(dom).classList.contains("next-read--open")).toBe(true);

		await fixture.articleStore.writeContent({ url: PENDING_CRAWL_URL, content: CRAWLED_BODY });
		await fixture.articleCrawl.markCrawlReady({ url: PENDING_CRAWL_URL });
		const polled = await agent.get(`/queue/${articleId}/reader?poll=1`);
		expect(polled.status).toBe(200);
		const slot = dom.window.document.querySelector(READER_SLOT);
		assert(slot, "the reader renders the slot the crawl poll swaps");
		slot.outerHTML = polled.text;
		const grown = dom.window.document.querySelector(READER_SLOT);
		assert(grown, "the swapped-in fragment keeps the slot the next poll would target");
		expect(grown.getAttribute("data-reader-status")).toBe("ready");

		putArticleEndAt(dom, fold * 4);
		dom.window.document.body.dispatchEvent(
			new dom.window.Event("htmx:afterSwap", { bubbles: true }),
		);

		expect(cardOf(dom).classList.contains("next-read--open")).toBe(false);
		dom.window.close();
	});
});
