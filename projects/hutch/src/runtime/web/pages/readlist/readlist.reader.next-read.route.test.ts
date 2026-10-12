import assert from "node:assert/strict";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
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
		readabilityAdditions,
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

describe("Reader next-read card — the article growing above it", () => {
	it("keeps the card after the article column while the crawl is pending and after the poll lands", async () => {
		const { fixture, agent, articleId } = await buildPendingReaderWithSuggestion();

		const view = await agent.get(`/queue/${articleId}/view`);
		expect(view.status).toBe(200);
		const doc = new JSDOM(view.text).window.document;
		const card = doc.querySelector(CARD);
		assert(card, "the reader always renders the next-read slot");
		const column = card.previousElementSibling;
		assert(column, "the next-read slot must follow the article column");
		const pending = column.querySelector(READER_SLOT);
		assert(pending, "the article column renders the slot the crawl poll swaps");
		expect({
			ready: card.classList.contains("next-read--ready"),
			column: column.classList.contains("reading-layout__main"),
			reader: pending.getAttribute("data-reader-status"),
		}).toEqual({ ready: true, column: true, reader: "pending" });

		await fixture.articleStore.writeContent({ url: PENDING_CRAWL_URL, content: CRAWLED_BODY });
		await fixture.articleCrawl.markCrawlReady({ url: PENDING_CRAWL_URL });
		const polled = await agent.get(`/queue/${articleId}/reader?poll=1`);

		expect(polled.status).toBe(200);
		const fragment = new JSDOM(polled.text).window.document;
		const grown = fragment.querySelector(READER_SLOT);
		assert(grown, "the poll answer carries the slot the next poll would target");
		expect({
			reader: grown.getAttribute("data-reader-status"),
			cards: fragment.querySelectorAll(CARD).length,
		}).toEqual({ reader: "ready", cards: 0 });
	});
});
