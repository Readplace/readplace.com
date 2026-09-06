import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const READER_PAGE_BUNDLES = [
	"/client-dist/share-balloon.client.js",
	"/client-dist/next-read.client.js",
	"/client-dist/progress-bar.client.js",
	"/client-dist/summary-toggle.client.js",
	"/client-dist/crawl-bookmark.client.js",
	"/client-dist/readlist-picker.client.js",
	"/client-dist/reader-exit-confirm.client.js",
	"/client-dist/reader-open.client.js",
];

function bundleSrcs(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("script[src]"))
		.map((el) => el.getAttribute("src") ?? "")
		.filter((src) => src.startsWith("/client-dist/"));
}

describe("GET /queue reader skeleton", () => {
	it("ships the reader skeleton template as the last child of an empty queue's main", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");
		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const main = doc.querySelector("main.readlist");
		assert(main, "the queue must render its main");
		const last = main.lastElementChild;
		assert(last, "the queue main must have a last element child");
		expect(last.tagName.toLowerCase()).toBe("template");
		expect(last.hasAttribute("data-reader-skeleton")).toBe(true);
		const template = doc.querySelector<HTMLTemplateElement>("template[data-reader-skeleton]");
		assert(template, "the skeleton template must be present");
		const slot = template.content.querySelector("[data-test-reader-skeleton]");
		assert(slot, "the skeleton template must hold its loading slot");
		expect(slot.getAttribute("data-reader-status")).toBe("loading");
	});

	it("loads every reader client bundle on the queue, in order, so a filled reader works", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const srcs = bundleSrcs(doc);
		const readerPageSrcs = srcs.filter((src) => READER_PAGE_BUNDLES.includes(src));
		expect(readerPageSrcs).toEqual(READER_PAGE_BUNDLES);
	});

	it("keeps the skeleton template on a queue that holds a saved article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const template = doc.querySelector("main.readlist template[data-reader-skeleton]");
		assert(template, "the populated queue must keep the skeleton template");
		expect(template.getAttribute("data-main-class")).toBe("reader");
		const title = doc.querySelector(".readlist-article [data-test-article-title]");
		assert(title, "the populated queue must render the saved article's card");
		expect(title.hasAttribute("data-opens-reader")).toBe(true);
	});
});
