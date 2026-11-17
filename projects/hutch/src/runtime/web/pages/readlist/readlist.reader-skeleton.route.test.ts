import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReaderArticleHashId } from "@packages/domain/article";
import { EnclosureSchema } from "@packages/media-contracts";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const AUDIO_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const AUDIO_ID = ReaderArticleHashId.from(AUDIO_URL).value;
const ENCLOSURE = EnclosureSchema.parse({
	object: `objects/sha256/${"0123456789abcdef".repeat(4)}/1`,
	mediaType: "audio/mpeg",
	durationSeconds: 2820,
});

function scriptsOutsideMain(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("script"))
		.filter((el) => el.closest("main") === null)
		.map(
			(el) =>
				el.getAttribute("src") ??
				`inline script /queue must render with the same text: ${(el.textContent ?? "").trim()}`,
		);
}

describe("GET /queue reader skeleton", () => {
	it("ships the reader skeleton template as the last child of an empty queue's main", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");
		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const main = doc.querySelector("main[data-test-readlist-page]");
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

	it("loads on the queue every script the reader renders outside main, so a card's boosted open keeps them", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the logged-in user must exist");
		await fixture.articleStore.savePrivateItem({
			url: AUDIO_URL,
			ownerUserId: user.userId,
			media: { kind: "audio", fileName: "talk.mp3" },
			savedAt: new Date("2026-11-05T00:00:00.000Z"),
		});
		assert.equal(await fixture.articleStore.setArticleEnclosure({ url: AUDIO_URL, enclosure: ENCLOSURE }), "recorded");

		const reader = await agent.get(`/queue/${AUDIO_ID}/view`).set(BROWSER_REQUEST_HEADERS);
		const queue = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);
		expect(reader.status).toBe(200);
		expect(queue.status).toBe(200);

		const readerScripts = scriptsOutsideMain(new JSDOM(reader.text).window.document);
		const queueScripts = scriptsOutsideMain(new JSDOM(queue.text).window.document);
		expect(readerScripts).toEqual(
			expect.arrayContaining([
				"/client-dist/player.client.js",
				"/client-dist/highlight-toolbar.client.js",
				"/client-dist/reader-exit-confirm.client.js",
			]),
		);
		const missing = readerScripts.filter((script) => !queueScripts.includes(script));
		expect({ missing }).toEqual({ missing: [] });
	});

	it("keeps the skeleton template on a queue that holds a saved article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const template = doc.querySelector("main[data-test-readlist-page] template[data-reader-skeleton]");
		assert(template, "the populated queue must keep the skeleton template");
		expect(template.getAttribute("data-main-class")).toBe("reader");
		const title = doc.querySelector(".readlist-article [data-test-article-title]");
		assert(title, "the populated queue must render the saved article's card");
		expect(title.hasAttribute("data-opens-reader")).toBe(true);
	});
});
