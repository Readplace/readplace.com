import assert from "node:assert/strict";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createNoopLogError,
} from "@packages/test-fixtures";
import type { Client } from "@node-oauth/oauth2-server";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/opened-post";
const RELATED_URL = "https://example.com/earlier-post";
const FOLLOW_UP_URL = "https://example.com/follow-up-post";
const CAPTURED_PAGE = Buffer.from(
	"<html><head><title>Opened post</title></head><body><article><h1>Opened post</h1><p>A page the client captured without the reader's tap, with enough words for the parser.</p></article></body></html>",
);
const COMPUTED_AT = new Date("2026-11-04T12:00:00.000Z");

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
	[ARTICLE_URL, "Opened post"],
	[RELATED_URL, "Earlier read"],
	[FOLLOW_UP_URL, "Still to read"],
]);

async function buildHarness() {
	const crawlArticle = async ({ url }: { url: string }) => {
		const title = TITLES.get(url);
		assert(title, `the test only crawls urls it seeded a title for: ${url}`);
		return { status: "fetched" as const, html: articleHtml(title), bodyHash: "a".repeat(64) };
	};
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
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
		},
	});
	const agent = await loginAgent(harness.server, harness.auth);

	const signedInUser = await fixture.auth.findUserByEmail("test@example.com");
	assert(signedInUser, "loginAgent creates the user it signs in as");
	const { userId } = signedInUser;

	async function articleIdOf(url: string): Promise<string> {
		const article = await fixture.articleStore.findArticleByUrl(url);
		assert(article, `saving ${url} must create an article row`);
		const saved = await fixture.articleStore.findArticleById(article.id, userId);
		assert(saved, `saving ${url} must attach the article to the signed-in reader`);
		return saved.id.value;
	}

	async function save(url: string): Promise<string> {
		await agent.post("/queue/save").type("form").send({ url });
		return articleIdOf(url);
	}

	async function queueAutomatically(url: string): Promise<string> {
		const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
		assert(client, "Test client must exist");
		const token = await harness.oauthModel.saveToken(
			{
				accessToken: "test-access-token-next-read-request",
				accessTokenExpiresAt: new Date(Date.now() + 3600000),
				refreshToken: "test-refresh-token-next-read-request",
				refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
				client: {
					id: "hutch-firefox-extension",
					grants: ["authorization_code", "refresh_token"],
					redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
				} satisfies Client,
				user: { id: userId },
			},
			client,
			{ id: userId },
		);
		assert(token, "Token should be saved");
		const captured = await request(harness.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token.accessToken}`)
			.field("url", url)
			.field("mediaType", "text/html")
			.field("captureTrigger", "automatic")
			.attach("content", CAPTURED_PAGE, "content");
		assert.equal(captured.status, 201, `the automatic capture of ${url} must be accepted`);
		return articleIdOf(url);
	}

	function open(articleId: string) {
		return agent.post(`/queue/${articleId}/topic-reads`).set("HX-Request", "true");
	}

	return { fixture, agent, userId, save, queueAutomatically, open };
}

function relatedSlotOf(html: string) {
	const slot = new JSDOM(html).window.document.querySelector("[data-test-reader-related]");
	assert(slot, "the reader always renders the related slot");
	return slot;
}

describe("Next read requested when the reader opens an article", () => {
	it("asks for Next read with Past reads the first time the reader opens an article", async () => {
		const { fixture, userId, save, open } = await buildHarness();
		const articleId = await save(ARTICLE_URL);

		const response = await open(articleId);

		expect(response.status).toBe(204);
		expect(fixture.publishedComputeRelatedPasses).toEqual([{ url: ARTICLE_URL, userId }]);
	});

	it("asks for Past reads alone when the reader opens the article again", async () => {
		const { fixture, userId, save, open } = await buildHarness();
		const articleId = await save(ARTICLE_URL);
		await open(articleId);

		await open(articleId);

		expect({
			passes: fixture.publishedComputeRelatedPasses,
			pastReads: fixture.publishedComputeRelatedPastReads,
		}).toEqual({
			passes: [{ url: ARTICLE_URL, userId }],
			pastReads: [{ url: ARTICLE_URL, userId }],
		});
	});

	it("asks for Next read on open for a link an automatic save queued", async () => {
		const { fixture, userId, queueAutomatically, open } = await buildHarness();
		const articleId = await queueAutomatically(ARTICLE_URL);
		assert.deepEqual(fixture.publishedComputeRelatedPasses, []);

		await open(articleId);

		expect(fixture.publishedComputeRelatedPasses).toEqual([{ url: ARTICLE_URL, userId }]);
	});

	it("shows the Next read card through the poll once the requested computation lands", async () => {
		const { fixture, agent, userId, save, open } = await buildHarness();
		const articleId = await save(ARTICLE_URL);
		await save(RELATED_URL);
		await save(FOLLOW_UP_URL);
		const reader = await agent.get(`/queue/${articleId}/view`);
		expect(relatedSlotOf(reader.text).getAttribute("hx-get")).toBe(
			`/queue/${articleId}/related?poll=1`,
		);

		await open(articleId);
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
		const polled = await agent.get(`/queue/${articleId}/related?poll=1`);

		const card = new JSDOM(polled.text).window.document.querySelector(".next-read__card");
		assert(card, "the poll answer renders the Next read card once the computation lands");
		expect(relatedSlotOf(polled.text).classList.contains("next-read--ready")).toBe(true);
	});
});
