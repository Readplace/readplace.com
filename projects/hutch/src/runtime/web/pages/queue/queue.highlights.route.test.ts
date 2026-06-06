import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type LoggedInAgent = Awaited<ReturnType<typeof loginAgent>>;

async function saveArticleAndGetId(agent: LoggedInAgent, url: string) {
	await agent.post("/queue/save").type("form").send({ url });
	const queueResponse = await agent.get("/queue");
	const id = new JSDOM(queueResponse.text).window.document
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert.ok(id, "saved article must appear in the queue");
	return id;
}

describe("Queue highlights routes", () => {
	it("creates a highlight and returns the re-rendered list fragment", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const id = await saveArticleAndGetId(agent, "https://example.com/highlight-create");

		const response = await agent
			.post(`/queue/${id}/highlights`)
			.send({ quote: "a sentence worth keeping", note: "remember this" });

		expect(response.status).toBe(201);
		const doc = new JSDOM(response.text).window.document;
		const item = doc.querySelector("[data-test-highlight]");
		assert(item, "the new highlight must be in the returned fragment");
		expect(item.getAttribute("data-highlight-quote")).toBe("a sentence worth keeping");
		expect(doc.querySelector("[data-test-highlight-note]")?.textContent).toBe("remember this");
	});

	it("surfaces saved highlights in the reader side panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const id = await saveArticleAndGetId(agent, "https://example.com/highlight-panel");

		await agent.post(`/queue/${id}/highlights`).send({ quote: "panel quote", note: "" });

		const readerResponse = await agent.get(`/queue/${id}/view`);
		const doc = new JSDOM(readerResponse.text).window.document;
		const panel = doc.querySelector("[data-highlights]");
		assert(panel, "reader must render the highlights panel");
		expect(panel.getAttribute("data-highlights-create-url")).toBe(`/queue/${id}/highlights`);
		expect(doc.querySelector("[data-test-highlight]")?.getAttribute("data-highlight-quote")).toBe(
			"panel quote",
		);
	});

	it("deletes a highlight and returns the empty-state fragment", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const id = await saveArticleAndGetId(agent, "https://example.com/highlight-delete");

		const createResponse = await agent
			.post(`/queue/${id}/highlights`)
			.send({ quote: "delete me", note: "" });
		const deleteUrl = new JSDOM(createResponse.text).window.document
			.querySelector("[data-test-highlight-delete]")
			?.getAttribute("action");
		assert.ok(deleteUrl, "delete form action must be present");

		const deleteResponse = await agent.post(deleteUrl);
		expect(deleteResponse.status).toBe(200);
		const doc = new JSDOM(deleteResponse.text).window.document;
		expect(doc.querySelectorAll("[data-test-highlight]")).toHaveLength(0);
		assert(
			doc.querySelector("[data-test-highlights-empty]"),
			"empty state must show once the last highlight is removed",
		);
	});

	it("rejects an empty quote with 422", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const id = await saveArticleAndGetId(agent, "https://example.com/highlight-empty");

		const response = await agent.post(`/queue/${id}/highlights`).send({ quote: "   ", note: "" });
		expect(response.status).toBe(422);
	});

	it("returns 404 when creating a highlight on an article the user does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post(`/queue/${"a".repeat(32)}/highlights`)
			.send({ quote: "ghost", note: "" });
		expect(response.status).toBe(404);
	});

	it("returns 404 when deleting a highlight on an unknown article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(`/queue/${"a".repeat(32)}/highlights/abc/delete`);
		expect(response.status).toBe(404);
	});
});
