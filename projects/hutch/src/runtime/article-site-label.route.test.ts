import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReadabilityParser } from "@packages/article-parser";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import request from "supertest";
import { loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const WRAPPER_URL = "https://wrapper.example/link/190528";
const WRAPPER_CANONICAL_PATH = "wrapper.example/link/190528";
const DESTINATION_URL = "https://destination.example/a-distributed-cache";

function articleHtml(extraHead = ""): string {
	return `
	<html><head><title>a distributed memory object caching system</title>${extraHead}</head>
	<body><article>
		<h1>a distributed memory object caching system</h1>
		<p>memcached is a high-performance, distributed memory object caching system, generic in nature but intended for use in speeding up dynamic web applications.</p>
		<p>It is an in-memory key-value store for small chunks of arbitrary data, with enough words here for readability to treat it as a real article body.</p>
	</article></body></html>`;
}

function buildHarness(html: string) {
	const crawlArticle = async () => ({ status: "fetched" as const, html, bodyHash: "b".repeat(64) });
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	});
	return { harness, fixture };
}

function hostOfHref(el: Element | null): string {
	const href = el?.getAttribute("href");
	assert(href, "the source link must carry an href");
	return new URL(href).hostname;
}

async function saveAdoptedArticle(html: string): Promise<{ harness: ReturnType<typeof buildHarness>["harness"]; articleId: string }> {
	const { harness, fixture } = buildHarness(html);
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url: WRAPPER_URL });
	await fixture.articleStore.setDisplayUrl({ url: WRAPPER_URL, displayUrl: DESTINATION_URL });

	const readlistDoc = new JSDOM((await agent.get("/queue")).text).window.document;
	const articleId = readlistDoc
		.querySelector("[data-test-article-list] .readlist-article")
		?.getAttribute("data-test-article");
	assert(articleId, "the saved article must have an id");
	return { harness, articleId };
}

describe("Article site label after a cross-host redirect", () => {
	it("names the destination on the queue card, the reader header and the public /view, and every label matches its own link", async () => {
		const { harness, articleId } = await saveAdoptedArticle(articleHtml());
		const agent = await loginAgent(harness.server, harness.auth);

		const cardDoc = new JSDOM((await agent.get("/queue")).text).window.document;
		const cardSite = cardDoc.querySelector("[data-test-article-url]");
		expect(cardSite?.textContent?.trim()).toBe("destination.example");
		expect(hostOfHref(cardSite)).toBe("destination.example");

		const readerDoc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;
		expect(readerDoc.querySelector("[data-test-reader-site]")?.textContent?.trim()).toBe("destination.example");
		expect(hostOfHref(readerDoc.querySelector("[data-test-original-link]"))).toBe("destination.example");

		const viewDoc = new JSDOM(
			(await request(harness.server).get(`/view/${WRAPPER_CANONICAL_PATH}`)).text,
		).window.document;
		expect(viewDoc.querySelector("[data-test-reader-site]")?.textContent?.trim()).toBe("destination.example");
		expect(hostOfHref(viewDoc.querySelector("[data-test-original-link]"))).toBe("destination.example");
	});

	it("keeps a site name the destination page actually declares, on every surface", async () => {
		const { harness, articleId } = await saveAdoptedArticle(
			articleHtml(`<meta property="og:site_name" content="Memcached Blog">`),
		);
		const agent = await loginAgent(harness.server, harness.auth);

		const cardDoc = new JSDOM((await agent.get("/queue")).text).window.document;
		expect(cardDoc.querySelector("[data-test-article-url]")?.textContent?.trim()).toBe("Memcached Blog");

		const readerDoc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;
		expect(readerDoc.querySelector("[data-test-reader-site]")?.textContent?.trim()).toBe("Memcached Blog");
		expect(hostOfHref(readerDoc.querySelector("[data-test-original-link]"))).toBe("destination.example");
	});
});
