import assert from "node:assert/strict";
import { calculateReadTime } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN, type TestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/post";
const VIEW_PATH = "/view/example.com/post";
const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const PRIVATE_VIEW_PATH = "/view/uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const WEBMAIL_URL = "https://mail.google.com/mail/u/0/";
const WEBMAIL_VIEW_PATH = "/view/mail.google.com/mail/u/0/";

async function seedReadable(input: { fixture: TestAppFixture; url: string; userId: UserId }): Promise<void> {
	await input.fixture.articleStore.saveArticle({
		userId: input.userId,
		url: input.url,
		metadata: { title: "A readable post", siteName: "Example", excerpt: "An excerpt.", wordCount: 6 },
		estimatedReadTime: calculateReadTime(6),
		provenance: { kind: "web" },
		saveTrigger: "manual",
		savedAt: new Date("2026-11-01T00:00:00.000Z"),
	});
	await input.fixture.articleStore.writeContent({
		url: input.url,
		content: "<p>The first paragraph opens the article. A second sentence follows it.</p>",
	});
	await input.fixture.articleCrawl.markCrawlReady({ url: input.url });
}

async function harnessWith(input: { urls: readonly string[]; owned?: string }) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const saver = await harness.auth.createUser({ email: "saver@example.com", password: "password123" });
	assert(saver.ok, "the saver is created");
	for (const url of input.urls) await seedReadable({ fixture, url, userId: saver.userId });
	if (input.owned !== undefined) {
		await fixture.articleStore.recordItemOwner({ url: input.owned, ownerUserId: saver.userId });
	}
	return harness;
}

interface LocalHighlightsMarkup {
	toolbar: Element | null;
	card: Element | null;
	popup: Element | null;
	scripts: string[];
}

function localHighlightsOf(html: string): LocalHighlightsMarkup {
	const doc = new JSDOM(html).window.document;
	return {
		toolbar: doc.querySelector("[data-highlight-toolbar]"),
		card: doc.querySelector("[data-test-view-highlights]"),
		popup: doc.getElementById("view-highlights-keep"),
		scripts: Array.from(doc.querySelectorAll("script[src]"), (script) => script.getAttribute("src") ?? "").filter(
			(src) => src.includes("highlight"),
		),
	};
}

function offered(markup: LocalHighlightsMarkup): boolean[] {
	return [markup.toolbar !== null, markup.card !== null, markup.popup !== null, markup.scripts.length > 0];
}

describe("/view — highlights kept in a logged-out visitor's browser", () => {
	it("offers a logged-out visitor the local toolbar, the card, the popup and both scripts, store first", async () => {
		const harness = await harnessWith({ urls: [ARTICLE_URL] });

		const response = await request(harness.server).get(VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		const markup = localHighlightsOf(response.text);
		assert(markup.toolbar, "the local toolbar renders");
		assert.equal(markup.toolbar.getAttribute("data-highlight-opened-url"), "/view/highlights/event");
		const doc = new JSDOM(response.text).window.document;
		const forms = Array.from(doc.querySelectorAll("[data-highlight-create-form], #note-highlight-dialog form"));
		assert.deepEqual(
			forms.map((form) => [
				form.hasAttribute("data-highlight-local"),
				form.getAttributeNames().filter((name) => name.startsWith("hx-")),
			]),
			[
				[true, []],
				[true, []],
			],
		);
		assert(markup.card, "the highlights card renders");
		assert.equal(markup.card.getAttribute("data-view-highlights-url"), ARTICLE_URL);
		assert(markup.popup, "the sign-up popup renders");
		assert.deepEqual(markup.scripts, ["/client-dist/view-highlights.client.js", "/client-dist/highlight-toolbar.client.js"]);
	});

	it("posts both keep forms to the keep route with this article, tracked as the view highlights CTA", async () => {
		const harness = await harnessWith({ urls: [ARTICLE_URL] });

		const response = await request(harness.server).get(VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		const forms = Array.from(doc.querySelectorAll("form[data-view-highlights-keep-form]"));
		assert.deepEqual(
			forms.map((form) => {
				const action = new URL(form.getAttribute("action") ?? "", "http://localhost");
				return [
					form.getAttribute("method"),
					action.pathname,
					action.searchParams.get("utm_source"),
					action.searchParams.get("utm_content"),
					action.searchParams.get("utm_term"),
					form.querySelector<HTMLInputElement>('input[name="article"]')?.value,
				];
			}),
			[
				["POST", "/view/highlights/keep", "view-highlights", "keep", "reader-public", ARTICLE_URL],
				["POST", "/view/highlights/keep", "view-highlights", "keep", "reader-public", ARTICLE_URL],
			],
		);
	});

	it("opens the popup on its create-account button", async () => {
		const harness = await harnessWith({ urls: [ARTICLE_URL] });

		const response = await request(harness.server).get(VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-view-highlights-keep-form] [autofocus]"), (element) =>
				element.getAttribute("data-test-action"),
			),
			["view-highlights-signup"],
		);
		assert.equal(doc.querySelector("#view-highlights-keep [autofocus]")?.getAttribute("value"), "signup");
	});

	it("states the browser's limit as a rule and holds back the too-long sentence until a refusal", async () => {
		const harness = await harnessWith({ urls: [ARTICLE_URL] });

		const response = await request(harness.server).get(VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		assert.equal(
			doc.getElementById("view-highlights-keep-body")?.textContent,
			"This browser keeps up to 5 highlights. Create a free account to keep them and add as many as you like.",
		);
		assert.deepEqual(
			Array.from(doc.querySelectorAll<HTMLElement>("[data-view-highlights-too-long]"), (sentence) => [
				sentence.hidden,
				sentence.textContent,
			]),
			[
				[true, "A passage or note longer than 1,000 characters needs an account."],
				[true, "A passage or note longer than 1,000 characters needs an account."],
			],
		);
	});

	it("offers none of it to a signed-in reader", async () => {
		const harness = await harnessWith({ urls: [ARTICLE_URL] });
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		assert.deepEqual(offered(localHighlightsOf(response.text)), [false, false, false, false]);
	});

	it("offers none of it on a private upload", async () => {
		const harness = await harnessWith({ urls: [PRIVATE_URL], owned: PRIVATE_URL });

		const response = await request(harness.server).get(PRIVATE_VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		assert.deepEqual(offered(localHighlightsOf(response.text)), [false, false, false, false]);
	});

	it("offers none of it on a webmail page", async () => {
		const harness = await harnessWith({ urls: [WEBMAIL_URL] });

		const response = await request(harness.server).get(WEBMAIL_VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		assert.deepEqual(offered(localHighlightsOf(response.text)), [false, false, false, false]);
	});

	it("offers none of it when the crawl failed and there is no body to highlight", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleCrawl: {
				...fixture.articleCrawl,
				findArticleCrawlStatus: async () => ({ status: "failed", outcomeRevision: 1, reason: "blocked" }),
			},
		});
		await fixture.articleStore.saveArticleGlobally({
			url: ARTICLE_URL,
			metadata: { title: "Seeded", siteName: "example.com", excerpt: "", wordCount: 500 },
			estimatedReadTime: calculateReadTime(500),
			savedAt: new Date("2026-11-01T00:00:00.000Z"),
		});

		const response = await request(harness.server).get(VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		assert.deepEqual(offered(localHighlightsOf(response.text)), [false, false, false, false]);
	});
});
