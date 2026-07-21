import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import type { CountArticlesQuery } from "@packages/provider-contracts/article-store";

const useApp = useTestServer();

const QUEUE_PAGE_SIZE = 20;

type LoggedInAgent = Awaited<ReturnType<typeof loginAgent>>;

function parseFragment(html: string): Document {
	return new JSDOM(`<main>${html}</main>`).window.document;
}

function swappedTargets(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[hx-swap-oob]"), (element) => element.id);
}

function unreadTab(doc: Document): Element {
	const tab = doc.querySelector('[data-test-filter="unread"]');
	assert(tab, "the counts fragment must carry the unread tab");
	return tab;
}

async function save(agent: LoggedInAgent, url: string): Promise<void> {
	await agent.post("/queue/save").type("form").send({ url });
}

async function saveMany(agent: LoggedInAgent, count: number, prefix: string): Promise<void> {
	for (let i = 0; i < count; i++) {
		await save(agent, `${prefix}${i}`);
	}
}

async function markFirstArticleRead(agent: LoggedInAgent): Promise<void> {
	const queue = await agent.get("/queue");
	const id = new JSDOM(queue.text).window.document
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(id, "a saved article must be listed before it can be marked read");
	await agent.post(`/queue/${id}/status`).type("form").send({ status: "read" });
}

describe("GET /queue/counts", () => {
	describe("unauthenticated", () => {
		it("should redirect to /login like the rest of the queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/queue/counts");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("authenticated", () => {
		it("should answer with an HTML fragment carrying the unread badge", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/a");
			await save(agent, "https://example.com/b");

			const response = await agent.get("/queue/counts");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toContain("text/html");
			const tab = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
			assert(tab, "the counts fragment must carry the unread tab");
			expect(tab.textContent).toBe("To Read (2)");
			expect(tab.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(tab.getAttribute("id")).toBe("queue-filter-unread");
		});

		it("should count zero for an empty queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue/counts");

			const tab = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
			expect(tab?.textContent).toBe("To Read (0)");
		});

		it("should mark the unread tab active on the To Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue/counts");

			const tab = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
			expect(tab?.getAttribute("class")).toBe(
				"queue__filter-link queue__filter-link--active",
			);
		});

		it("should still report the unread count while the reader is on the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/1");
			await save(agent, "https://example.com/2");
			await save(agent, "https://example.com/3");
			await markFirstArticleRead(agent);

			const response = await agent.get("/queue/counts?tab=done");

			const tab = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
			expect(tab?.textContent).toBe("To Read (2)");
			expect(tab?.getAttribute("class")).toBe("queue__filter-link");
		});

		it("should swap only the unread tab when the tab has no pagination to swap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/only");

			const response = await agent.get("/queue/counts");

			const doc = parseFragment(response.text);
			expect(swappedTargets(doc)).toEqual(["queue-filter-unread"]);
			expect(unreadTab(doc).textContent).toBe("To Read (1)");
		});

		it("should fill in the total page count once the tab spans pages", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, QUEUE_PAGE_SIZE + 1, "https://example.com/page-");

			const response = await agent.get("/queue/counts");

			const info = parseFragment(response.text).querySelector("[data-test-pagination-info]");
			assert(info, "the counts fragment must carry the pagination info across pages");
			expect(info.textContent).toBe("Page 1 of 2");
			expect(info.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(info.getAttribute("id")).toBe("queue-pagination-info");
		});

		it("should report the requested page in the pagination fragment", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, QUEUE_PAGE_SIZE + 1, "https://example.com/p-");

			const response = await agent.get("/queue/counts?page=2");

			const info = parseFragment(response.text).querySelector("[data-test-pagination-info]");
			expect(info?.textContent).toBe("Page 2 of 2");
		});

		it("should count the Read tab, not the queue, when asked for the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, QUEUE_PAGE_SIZE + 1, "https://example.com/r-");

			const response = await agent.get("/queue/counts?tab=done");

			const doc = parseFragment(response.text);
			expect(swappedTargets(doc)).toEqual(["queue-filter-unread"]);
			expect(unreadTab(doc).textContent).toBe(`To Read (${QUEUE_PAGE_SIZE + 1})`);
		});
	});

	describe("partition scans", () => {
		function fixtureRecordingCounts(): {
			fixture: ReturnType<typeof createDefaultTestAppFixture>;
			counted: CountArticlesQuery[];
		} {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const counted: CountArticlesQuery[] = [];
			const countArticlesByUser = fixture.articleStore.countArticlesByUser;
			return {
				counted,
				fixture: {
					...fixture,
					articleStore: {
						...fixture.articleStore,
						countArticlesByUser: async (query: CountArticlesQuery) => {
							counted.push(query);
							return countArticlesByUser(query);
						},
					},
				},
			};
		}

		it("should scan the partition once when the badge and the tab describe the same rows", async () => {
			const { fixture, counted } = fixtureRecordingCounts();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/one-scan");
			counted.length = 0;

			const response = await agent.get("/queue/counts");

			expect(unreadTab(parseFragment(response.text)).textContent).toBe("To Read (1)");
			expect(counted.map((query) => query.status)).toEqual(["unread"]);
		});

		it("should scan once per tab when the badge and the tab describe different rows", async () => {
			const { fixture, counted } = fixtureRecordingCounts();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/two-scans");
			counted.length = 0;

			const response = await agent.get("/queue/counts?tab=done");

			expect(unreadTab(parseFragment(response.text)).textContent).toBe("To Read (1)");
			expect(counted.map((query) => query.status)).toEqual(["read", "unread"]);
		});
	});

	describe("swapping into the rendered queue", () => {
		it("should target elements the queue page actually rendered", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, QUEUE_PAGE_SIZE + 1, "https://example.com/swap-");

			const page = new JSDOM((await agent.get("/queue")).text).window.document;
			const fragment = parseFragment((await agent.get("/queue/counts")).text);

			for (const id of ["queue-filter-unread", "queue-pagination-info"]) {
				const target = page.getElementById(id);
				const replacement = fragment.getElementById(id);
				assert(target, `the queue page must render #${id} for the counts swap to land on`);
				assert(replacement, `the counts fragment must carry #${id}`);
				expect(replacement.tagName).toBe(target.tagName);
				expect(replacement.getAttribute("class")).toBe(target.getAttribute("class"));
			}
		});

		it("should keep the unread tab href the queue page rendered so the tab keeps working", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/href");

			const page = new JSDOM((await agent.get("/queue?tab=done")).text).window.document;
			const fragment = parseFragment((await agent.get("/queue/counts?tab=done")).text);

			const rendered = page.getElementById("queue-filter-unread")?.getAttribute("href");
			assert(rendered, "the queue page must render an href on the unread tab");
			expect(fragment.getElementById("queue-filter-unread")?.getAttribute("href")).toBe(rendered);
		});

		it("should be requested by the queue page on load, carrying the reader's filters", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const page = new JSDOM((await agent.get("/queue?tab=done&order=asc")).text).window.document;

			const trigger = page.querySelector("[data-test-queue-counts]");
			assert(trigger, "the queue page must trigger the out-of-band counts request");
			expect(trigger.getAttribute("hx-trigger")).toBe("load");
			expect(trigger.getAttribute("hx-swap")).toBe("none");
			expect(trigger.getAttribute("hx-get")).toBe("/queue/counts?tab=done&order=asc");
		});
	});
});
