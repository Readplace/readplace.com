import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

async function setupArticle() {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const agent = await loginAgent(harness.server, harness.auth);
	await agent
		.post("/queue/save")
		.type("form")
		.send({ url: "https://example.com/article" });
	const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
	const articleId = queueDoc
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(articleId, "saved article should expose an id");
	return { harness, agent, articleId };
}

async function viewDoc(agent: Awaited<ReturnType<typeof setupArticle>>["agent"], articleId: string) {
	return new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;
}

function panelOf(doc: Document): Element {
	const panel = doc.querySelector("[data-highlights-panel]");
	assert(panel, "reader view must render the highlights panel");
	return panel;
}

describe("Queue highlight routes", () => {
	describe("POST /queue/:id/highlights", () => {
		it("creates a highlight that then renders in the reader side-menu", async () => {
			const { agent, articleId } = await setupArticle();

			const response = await agent
				.post(`/queue/${articleId}/highlights`)
				.type("form")
				.send({ start: "0", end: "5", quote: "Hello" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue/${articleId}/view`);

			const doc = await viewDoc(agent, articleId);
			const items = doc.querySelectorAll("[data-highlights-item]");
			expect(items.length).toBe(1);
			expect(items[0].getAttribute("data-rp-start")).toBe("0");
			expect(items[0].getAttribute("data-rp-end")).toBe("5");
			expect(items[0].querySelector("[data-test-highlights-quote]")?.textContent).toBe("Hello");
		});

		it("persists an optional note submitted alongside the highlight", async () => {
			const { agent, articleId } = await setupArticle();

			await agent
				.post(`/queue/${articleId}/highlights`)
				.type("form")
				.send({ start: "0", end: "5", quote: "Hello", note: "first thought" });

			const doc = await viewDoc(agent, articleId);
			expect(doc.querySelector("textarea[name='note']")?.textContent).toBe("first thought");
		});

		it("ignores an invalid anchor (end not past start) and saves nothing", async () => {
			const { agent, articleId } = await setupArticle();

			const response = await agent
				.post(`/queue/${articleId}/highlights`)
				.type("form")
				.send({ start: "5", end: "5", quote: "x" });

			expect(response.status).toBe(303);
			const panel = panelOf(await viewDoc(agent, articleId));
			expect(panel.getAttribute("data-highlights-count")).toBe("0");
			expect(panel.querySelectorAll("[data-highlights-item]").length).toBe(0);
		});

		it("redirects without saving for a malformed article id", async () => {
			const { agent } = await setupArticle();

			const response = await agent
				.post("/queue/not-a-valid-hash/highlights")
				.type("form")
				.send({ start: "0", end: "5", quote: "Hello" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue/not-a-valid-hash/view");
		});
	});

	describe("POST /queue/:id/highlights/:highlightId/note", () => {
		it("updates the note shown in the side-menu", async () => {
			const { agent, articleId } = await setupArticle();
			await agent
				.post(`/queue/${articleId}/highlights`)
				.type("form")
				.send({ start: "0", end: "5", quote: "Hello" });
			const highlightId = (await viewDoc(agent, articleId))
				.querySelector("[data-highlights-item]")
				?.getAttribute("data-rp-highlight-id");
			assert(highlightId, "created highlight should expose an id");

			const response = await agent
				.post(`/queue/${articleId}/highlights/${highlightId}/note`)
				.type("form")
				.send({ note: "remember this" });

			expect(response.status).toBe(303);
			const doc = await viewDoc(agent, articleId);
			expect(doc.querySelector("textarea[name='note']")?.textContent).toBe("remember this");
		});

		it("redirects without error for a malformed highlight id", async () => {
			const { agent, articleId } = await setupArticle();

			const response = await agent
				.post(`/queue/${articleId}/highlights/not-a-valid-hash/note`)
				.type("form")
				.send({ note: "x" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue/${articleId}/view`);
		});
	});

	describe("POST /queue/:id/highlights/:highlightId/delete", () => {
		it("removes the highlight from the side-menu", async () => {
			const { agent, articleId } = await setupArticle();
			await agent
				.post(`/queue/${articleId}/highlights`)
				.type("form")
				.send({ start: "0", end: "5", quote: "Hello" });
			const highlightId = (await viewDoc(agent, articleId))
				.querySelector("[data-highlights-item]")
				?.getAttribute("data-rp-highlight-id");
			assert(highlightId, "created highlight should expose an id");

			const response = await agent.post(
				`/queue/${articleId}/highlights/${highlightId}/delete`,
			);

			expect(response.status).toBe(303);
			const panel = panelOf(await viewDoc(agent, articleId));
			expect(panel.getAttribute("data-highlights-count")).toBe("0");
			expect(panel.querySelectorAll("[data-highlights-item]").length).toBe(0);
		});

		it("redirects without error for a malformed highlight id", async () => {
			const { agent, articleId } = await setupArticle();

			const response = await agent.post(
				`/queue/${articleId}/highlights/not-a-valid-hash/delete`,
			);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue/${articleId}/view`);
		});
	});
});
