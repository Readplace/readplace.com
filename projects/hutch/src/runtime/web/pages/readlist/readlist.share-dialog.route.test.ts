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
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
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

async function saveAndOpenReader(appOrigin: string): Promise<Document> {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML, bodyHash: "a".repeat(64) });
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
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishLinkQueued: fixture.events.publishLinkQueued,
			publishLinkDequeued: fixture.events.publishLinkDequeued,
			publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
			publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
	return new JSDOM(response.text).window.document;
}

function sharedLinks(doc: Document): URL[] {
	const dialog = doc.querySelector('[data-test-confirm-popover="share"]');
	assert(dialog, "the reader must render its share dialog");
	const field = dialog.querySelector<HTMLInputElement>("[data-test-share-url]");
	assert(field, "the share dialog must show the link");
	const facebook = dialog.querySelector('[data-test-share-target="facebook"]');
	assert(facebook, "the share dialog must offer Facebook");
	return [new URL(field.value), new URL(new URL(facebook.getAttribute("href") ?? "").searchParams.get("u") ?? "")];
}

describe("GET /queue/:id/view share dialog", () => {
	it("shares the public view of the article on the default test fixture's appOrigin", async () => {
		const doc = await saveAndOpenReader(TEST_APP_ORIGIN);

		expect(sharedLinks(doc).map((link) => `${link.origin}${link.pathname}`)).toEqual([
			`${TEST_APP_ORIGIN}/view/example.com/shareable`,
			`${TEST_APP_ORIGIN}/view/example.com/shareable`,
		]);
	});

	it("shares links against the appOrigin configured at the composition root (not a hardcoded host)", async () => {
		const doc = await saveAndOpenReader("https://staging.readplace.com");

		expect(sharedLinks(doc).map((link) => link.origin)).toEqual([
			"https://staging.readplace.com",
			"https://staging.readplace.com",
		]);
	});
});
