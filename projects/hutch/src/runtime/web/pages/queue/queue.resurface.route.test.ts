import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

async function saveArticle(agent: ReturnType<typeof request.agent>, url: string): Promise<void> {
	await agent.post("/queue/save").type("form").send({ url });
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("Queue resurface", () => {
	it("exposes the resurface CTA next to the save bar", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue")).text);

		expect(doc.querySelector('[data-test-form="resurface"]')?.getAttribute("action")).toBe("/queue/resurface");
		const resurfacedTab = doc.querySelector('[data-test-filter="resurfaced"]');
		assert(resurfacedTab, "resurfaced filter tab must be rendered");
		expect(resurfacedTab.classList.contains("queue__filter-link--hidden")).toBe(true);
	});

	it("matches saved articles to the prompt and shows them under the Resurfaced tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticle(agent, "https://coffee.example.com/beans");
		await saveArticle(agent, "https://rust.example.com/guide");
		await saveArticle(agent, "https://astronomy.example.com/stars");

		const post = await agent.post("/queue/resurface").type("form").send({ prompt: "coffee" });

		expect(post.status).toBe(303);
		expect(post.headers.location).toBe("/queue?tab=resurfaced");

		const doc = parse((await agent.get("/queue?tab=resurfaced")).text);
		const cards = doc.querySelectorAll("[data-test-article-list] .queue-article");
		expect(cards.length).toBe(1);
		expect(cards[0]?.querySelector("[data-test-article-title]")?.textContent).toContain("coffee.example.com");
		expect(doc.querySelector("[data-test-resurface-banner]")?.textContent).toContain("Showing 1 saved article matching");
		const resurfacedTab = doc.querySelector('[data-test-filter="resurfaced"]');
		assert(resurfacedTab, "resurfaced filter tab must be rendered");
		expect(resurfacedTab.classList.contains("queue__filter-link--hidden")).toBe(false);

		const queueDoc = parse((await agent.get("/queue")).text);
		const queueResurfacedTab = queueDoc.querySelector('[data-test-filter="resurfaced"]');
		assert(queueResurfacedTab, "resurfaced filter tab must be rendered");
		expect(queueResurfacedTab.classList.contains("queue__filter-link--hidden")).toBe(false);
	});

	it("opens an inviting, empty Resurfaced tab before any resurface has run", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue?tab=resurfaced")).text);

		expect(doc.querySelectorAll("[data-test-article-list] .queue-article").length).toBe(0);
		expect(doc.querySelector("[data-test-resurface-banner]")?.textContent).toContain("Use Resurface above");
		const resurfacedTab = doc.querySelector('[data-test-filter="resurfaced"]');
		assert(resurfacedTab, "resurfaced filter tab must be rendered");
		expect(resurfacedTab.classList.contains("queue__filter-link--hidden")).toBe(false);
		const emptyQueue = doc.querySelector("[data-test-empty-queue]");
		assert(emptyQueue, "empty queue element must be rendered");
		expect(emptyQueue.classList.contains("queue__empty--hidden")).toBe(true);
	});

	it("drops resurfaced articles that were deleted after the resurface ran", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticle(agent, "https://coffee.example.com/beans");
		await saveArticle(agent, "https://coffee-bar.example.com/menu");

		await agent.post("/queue/resurface").type("form").send({ prompt: "coffee" });

		const before = parse((await agent.get("/queue?tab=resurfaced")).text);
		const cards = before.querySelectorAll("[data-test-article-list] .queue-article");
		expect(cards.length).toBe(2);
		expect(before.querySelector("[data-test-resurface-banner]")?.textContent).toContain("Showing 2 saved articles matching");
		const idToDelete = cards[0]?.getAttribute("data-test-article");

		await agent.post(`/queue/${idToDelete}/delete`).type("form").send({});

		const after = parse((await agent.get("/queue?tab=resurfaced")).text);
		expect(after.querySelectorAll("[data-test-article-list] .queue-article").length).toBe(1);
	});

	it("overwrites the previous resurfaced set on the next resurface", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticle(agent, "https://coffee.example.com/beans");
		await saveArticle(agent, "https://rust.example.com/guide");

		await agent.post("/queue/resurface").type("form").send({ prompt: "coffee" });
		await agent.post("/queue/resurface").type("form").send({ prompt: "rust" });

		const cards = parse((await agent.get("/queue?tab=resurfaced")).text)
			.querySelectorAll("[data-test-article-list] .queue-article");
		expect(cards.length).toBe(1);
		expect(cards[0]?.querySelector("[data-test-article-title]")?.textContent).toContain("rust.example.com");
	});

	it("shows a no-match message when nothing matches the prompt", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticle(agent, "https://coffee.example.com/beans");

		await agent.post("/queue/resurface").type("form").send({ prompt: "supernova" });

		const doc = parse((await agent.get("/queue?tab=resurfaced")).text);
		expect(doc.querySelectorAll("[data-test-article-list] .queue-article").length).toBe(0);
		expect(doc.querySelector("[data-test-resurface-banner]")?.textContent).toContain("No saved articles matched");
		const emptyQueue = doc.querySelector("[data-test-empty-queue]");
		assert(emptyQueue, "empty queue element must be rendered");
		expect(emptyQueue.classList.contains("queue__empty--hidden")).toBe(true);
	});

	it("ignores an empty prompt without recording a resurface", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const post = await agent.post("/queue/resurface").type("form").send({ prompt: "   " });

		expect(post.status).toBe(303);
		expect(post.headers.location).toBe("/queue");
		const doc = parse((await agent.get("/queue")).text);
		const resurfacedTab = doc.querySelector('[data-test-filter="resurfaced"]');
		assert(resurfacedTab, "resurfaced filter tab must be rendered");
		expect(resurfacedTab.classList.contains("queue__filter-link--hidden")).toBe(true);
	});

	it("redirects back to the queue when the matcher fails", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.matchArticlesByInterest = async () => {
			throw new Error("matcher unavailable");
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticle(agent, "https://coffee.example.com/beans");

		const post = await agent.post("/queue/resurface").type("form").send({ prompt: "coffee" });

		expect(post.status).toBe(303);
		expect(post.headers.location).toBe("/queue");
	});

	it("requires authentication", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/resurface")
			.type("form")
			.send({ prompt: "coffee" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});
