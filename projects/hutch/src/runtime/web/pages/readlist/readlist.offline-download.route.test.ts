import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

async function signedIn(): Promise<TestAgent> {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	return loginAgent(harness.server, harness.auth);
}

async function save(agent: TestAgent, url: string): Promise<void> {
	const response = await agent.post("/queue/save").type("form").send({ url });
	assert.equal(response.status, 303, `saving ${url} must redirect back to the listing`);
}

async function page(agent: TestAgent, path: string): Promise<Document> {
	const response = await agent.get(path);
	assert.equal(response.status, 200, `${path} must render`);
	return new JSDOM(response.text).window.document;
}

function offlineDownload(doc: Document): Element {
	const control = doc.querySelector("main [data-test-offline-download]");
	assert(control, "the listing header must always carry the unread download control");
	return control;
}

describe("the unread download control on GET /queue", () => {
	it("offers the download on the To Read tab, tracked as its own click and pointing at the listing's first page", async () => {
		const agent = await signedIn();
		await save(agent, "https://example.com/offline-download-offered");

		const control = offlineDownload(await page(agent, "/queue?order=asc"));

		expect(control.classList.contains("readlist-listing__offline--offered")).toBe(true);
		const href = new URL(control.getAttribute("data-offline-download") ?? "", TEST_APP_ORIGIN);
		expect(href.pathname).toBe("/queue");
		expect(Object.fromEntries(href.searchParams)).toEqual({
			order: "asc",
			utm_source: "queue-listing",
			utm_medium: "internal",
			utm_content: "download-offline",
		});
	});

	it("withholds the download on the Read tab, even when it lists articles", async () => {
		const agent = await signedIn();
		await save(agent, "https://example.com/offline-download-read");
		const card = (await page(agent, "/queue")).querySelector("[data-test-article-list] [data-test-article]");
		const articleId = card?.getAttribute("data-test-article");
		assert(articleId, "the saved article must be listed on the To Read tab");
		const marked = await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });
		assert.equal(marked.status, 303, "marking the article read must redirect back to the listing");

		const doc = await page(agent, "/queue?tab=done");

		expect(doc.querySelectorAll("[data-test-article-list] [data-test-article]")).toHaveLength(1);
		expect(offlineDownload(doc).classList.contains("readlist-listing__offline--withheld")).toBe(true);
	});

	it("withholds the download from a readlist with nothing to read", async () => {
		const agent = await signedIn();

		const control = offlineDownload(await page(agent, "/queue"));

		expect(control.classList.contains("readlist-listing__offline--withheld")).toBe(true);
	});

	it("names the next and previous pages of a long listing by their link relation", async () => {
		const agent = await signedIn();
		for (let i = 0; i < 21; i++) await save(agent, `https://example.com/offline-download-page-${i}`);

		const first = await page(agent, "/queue");
		const second = await page(agent, "/queue?page=2");

		const next = first.querySelector("main nav.pagination a[rel='next']");
		assert(next, "the first page must link to the next one by its relation");
		expect(new URL(next.getAttribute("href") ?? "", TEST_APP_ORIGIN).searchParams.get("page")).toBe("2");
		const prev = second.querySelector("main nav.pagination a[rel='prev']");
		assert(prev, "the second page must link back to the first by its relation");
		expect(new URL(prev.getAttribute("href") ?? "", TEST_APP_ORIGIN).searchParams.get("page")).toBeNull();
		const lastNext = second.querySelector("main [data-test-pagination-next]");
		assert(lastNext, "the last page must still render its Next control");
		expect(lastNext.tagName.toLowerCase()).toBe("span");
	});
});
