import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
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
import { initReadabilityParser } from "@packages/article-parser";
import type { TestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const ARTICLE_HTML = `
<html><head><title>Presence Post</title></head>
<body><article>
	<h1>Presence Post</h1>
	<p>Long enough body text for the readability parser to extract a clean article from.</p>
	<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
</article></body></html>`;

function buildHarness() {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML });
	const fixture: TestAppFixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
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
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
			publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
			publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
			publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
			publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
			publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
			publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
		},
	});
}

async function saveAndResolve(harness: ReturnType<typeof buildHarness>, url: string) {
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url });
	const queueResponse = await agent.get("/queue");
	const articleId = new JSDOM(queueResponse.text).window.document
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert.ok(articleId, "saved article must show up in queue");
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist");
	return { agent, articleId, userId: user.userId };
}

describe("Queue reader-view presence (viewedAt)", () => {
	it("stamps viewedAt when the owner opens GET /queue/:id/view", async () => {
		const harness = buildHarness();
		const url = "https://example.com/presence-view";
		const { agent, articleId, userId } = await saveAndResolve(harness, url);

		const before = await harness.articleStore.findUserArticleNotificationState({ userId, url });
		assert(before, "user-article row must exist after save");
		expect(before.viewedAt).toBeUndefined();

		await agent.get(`/queue/${articleId}/view`);

		const after = await harness.articleStore.findUserArticleNotificationState({ userId, url });
		expect(after?.viewedAt).toBeInstanceOf(Date);
	});

	it("stamps viewedAt on the in-reader poll GET /queue/:id/summary", async () => {
		const harness = buildHarness();
		const url = "https://example.com/presence-summary";
		const { agent, articleId, userId } = await saveAndResolve(harness, url);

		await agent.get(`/queue/${articleId}/summary?poll=1`);

		const after = await harness.articleStore.findUserArticleNotificationState({ userId, url });
		expect(after?.viewedAt).toBeInstanceOf(Date);
	});

	it("stamps viewedAt on the in-reader poll GET /queue/:id/reader", async () => {
		const harness = buildHarness();
		const url = "https://example.com/presence-reader";
		const { agent, articleId, userId } = await saveAndResolve(harness, url);

		await agent.get(`/queue/${articleId}/reader?poll=1`);

		const after = await harness.articleStore.findUserArticleNotificationState({ userId, url });
		expect(after?.viewedAt).toBeInstanceOf(Date);
	});

	it("does NOT stamp viewedAt on the queue-list glance GET /queue/:id/card", async () => {
		const harness = buildHarness();
		const url = "https://example.com/presence-card";
		const { agent, articleId, userId } = await saveAndResolve(harness, url);

		await agent.get(`/queue/${articleId}/card`);

		const after = await harness.articleStore.findUserArticleNotificationState({ userId, url });
		assert(after, "user-article row must exist after save");
		expect(after.viewedAt).toBeUndefined();
	});
});
