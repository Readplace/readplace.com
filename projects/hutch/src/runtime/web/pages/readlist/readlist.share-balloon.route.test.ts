import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
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
import { useTestServer } from "../../../test-app";
import { SESSION_COOKIE_NAME } from "@packages/web-session";

const ARTICLE_URL = "https://example.com/shareable";
const ARTICLE_HTML = `
<html><head><title>Shareable</title></head>
<body><article>
	<h1>Shareable</h1>
	<p>Body copy that easily clears the readability threshold check.</p>
	<p>A second paragraph adds enough words for the parser to succeed.</p>
</article></body></html>`;

const useApp = useTestServer();

async function saveAndOpenReader(appOrigin: string): Promise<{ doc: Document; articleId: string }> {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML, bodyHash: "a".repeat(64) });
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
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishLinkQueued: fixture.events.publishLinkQueued,
			publishLinkDequeued: fixture.events.publishLinkDequeued,
			publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
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
		shared: { ...fixture.shared, appOrigin },
	});
	/** Authenticate with an explicit Cookie header instead of the agent's cookie
	 * jar: an https appOrigin marks the session cookie Secure, and the jar
	 * (correctly) refuses to replay Secure cookies over supertest's plain-http
	 * connection. Cookie transport is covered elsewhere —
	 * this test is about share-URL rendering. */
	const created = await harness.auth.createUser({ email: "test@example.com", password: "password123" });
	assert(created.ok, "test user must be created");
	const sessionId = await harness.auth.createSession({ userId: created.userId, emailVerified: true });
	const sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

	await request(harness.server).post("/queue/save").set("Cookie", sessionCookie).type("form").send({ url: ARTICLE_URL });
	const readlistDoc = new JSDOM((await request(harness.server).get("/queue").set("Cookie", sessionCookie)).text).window.document;
	const articleId = readlistDoc
		.querySelector("[data-test-article-list] .readlist-article")
		?.getAttribute("data-test-article");
	assert(articleId, "saved article must surface in the readlist");

	const response = await request(harness.server).get(`/queue/${articleId}/view`).set("Cookie", sessionCookie);
	expect(response.status).toBe(200);
	return { doc: new JSDOM(response.text).window.document, articleId };
}

describe("GET /queue/:id/view share balloon", () => {
	it("carries the owner's share-beacon target on the balloon wrap", async () => {
		const { doc, articleId } = await saveAndOpenReader(TEST_APP_ORIGIN);

		const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
		assert(wrap, "the balloon wrap must be rendered");
		expect(wrap.getAttribute("data-share-stamp-url")).toBe(`/queue/${articleId}/share`);
	});

	it("renders share URLs using the default test fixture's appOrigin", async () => {
		const { doc } = await saveAndOpenReader(TEST_APP_ORIGIN);

		const btn = doc.querySelector("[data-test-share-balloon]");
		assert(btn, "share button must be rendered");
		const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
		expect(shareUrl.origin).toBe(TEST_APP_ORIGIN);
		expect(shareUrl.pathname).toBe(`/view/example.com/shareable`);

		const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
		assert(copyBtn, "copy button must be rendered");
		const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
		expect(copyUrl.origin).toBe(TEST_APP_ORIGIN);
		expect(copyUrl.pathname).toBe(`/view/example.com/shareable`);
	});

	it("renders share URLs against the appOrigin configured at the composition root (not a hardcoded host)", async () => {
		const { doc } = await saveAndOpenReader("https://staging.readplace.com");

		const btn = doc.querySelector("[data-test-share-balloon]");
		assert(btn, "share button must be rendered");
		const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
		expect(shareUrl.origin).toBe("https://staging.readplace.com");

		const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
		assert(copyBtn, "copy button must be rendered");
		const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
		expect(copyUrl.origin).toBe("https://staging.readplace.com");
	});
});
