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

const READLIST_PAGE_SIZE = 20;

type LoggedInAgent = Awaited<ReturnType<typeof loginAgent>>;

function parseFragment(html: string): Document {
	return new JSDOM(`<main>${html}</main>`).window.document;
}

function swappedTargets(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[hx-swap-oob]"), (element) => element.id);
}

function unreadLabel(doc: Document): Element {
	const label = doc.getElementById("readlist-unread-label");
	assert(label, "the counts fragment must carry the unread tab's label");
	return label;
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
	const readlist = await agent.get("/queue");
	const id = new JSDOM(readlist.text).window.document
		.querySelector("[data-test-article-list] .readlist-article")
		?.getAttribute("data-test-article");
	assert(id, "a saved article must be listed before it can be marked read");
	await agent.post(`/queue/${id}/status`).type("form").send({ status: "read" });
}

describe("GET /queue/counts", () => {
	describe("unauthenticated", () => {
		it("should redirect to /login like the rest of the readlist", async () => {
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
			const label = unreadLabel(parseFragment(response.text));
			expect(label.textContent).toBe("To Read (2)");
			expect(label.getAttribute("hx-swap-oob")).toBe("innerHTML");
			expect(label.getAttribute("id")).toBe("readlist-unread-label");
		});

		it("should count zero for an empty readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue/counts");

			expect(unreadLabel(parseFragment(response.text)).textContent).toBe("To Read (0)");
		});

		it("should still report the unread count while the reader is on the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/1");
			await save(agent, "https://example.com/2");
			await save(agent, "https://example.com/3");
			await markFirstArticleRead(agent);

			const response = await agent.get("/queue/counts?tab=done");

			expect(unreadLabel(parseFragment(response.text)).textContent).toBe("To Read (2)");
		});

		it("should swap only the unread label when the tab has no pagination to swap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/only");

			const response = await agent.get("/queue/counts");

			const doc = parseFragment(response.text);
			expect(swappedTargets(doc)).toEqual(["readlist-unread-label"]);
			expect(unreadLabel(doc).textContent).toBe("To Read (1)");
		});

		it("should fill in the total page count once the tab spans pages", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/page-");

			const response = await agent.get("/queue/counts");

			const info = parseFragment(response.text).querySelector("[data-test-pagination-info]");
			assert(info, "the counts fragment must carry the pagination info across pages");
			expect(info.textContent).toBe("Page 1 of 2");
			expect(info.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(info.getAttribute("id")).toBe("readlist-pagination-info");
		});

		it("should report the requested page in the pagination fragment", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/p-");

			const response = await agent.get("/queue/counts?page=2");

			const info = parseFragment(response.text).querySelector("[data-test-pagination-info]");
			expect(info?.textContent).toBe("Page 2 of 2");
		});

		it("should count the Read tab, not the readlist, when asked for the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/r-");

			const response = await agent.get("/queue/counts?tab=done");

			const doc = parseFragment(response.text);
			expect(swappedTargets(doc)).toEqual(["readlist-unread-label"]);
			expect(unreadLabel(doc).textContent).toBe(`To Read (${READLIST_PAGE_SIZE + 1})`);
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

			expect(unreadLabel(parseFragment(response.text)).textContent).toBe("To Read (1)");
			expect(counted.map((query) => query.status)).toEqual(["unread"]);
		});

		it("should scan once per tab when the badge and the tab describe different rows", async () => {
			const { fixture, counted } = fixtureRecordingCounts();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/two-scans");
			counted.length = 0;

			const response = await agent.get("/queue/counts?tab=done");

			expect(unreadLabel(parseFragment(response.text)).textContent).toBe("To Read (1)");
			expect(counted.map((query) => query.status)).toEqual(["read", "unread"]);
		});
	});

	describe("swapping into the rendered readlist", () => {
		it("should target elements the readlist page actually rendered", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/swap-");

			const page = new JSDOM((await agent.get("/queue")).text).window.document;
			const fragment = parseFragment((await agent.get("/queue/counts")).text);

			for (const id of ["readlist-unread-label", "readlist-pagination-info"]) {
				const target = page.getElementById(id);
				const replacement = fragment.getElementById(id);
				assert(target, `the readlist page must render #${id} for the counts swap to land on`);
				assert(replacement, `the counts fragment must carry #${id}`);
				expect(replacement.tagName).toBe(target.tagName);
				expect(replacement.getAttribute("class")).toBe(target.getAttribute("class"));
			}
		});

		it("should preserve the label the page rendered and refresh it without re-arming preserve", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/preserve");

			const page = new JSDOM((await agent.get("/queue?tab=done")).text).window.document;
			const fragment = parseFragment((await agent.get("/queue/counts?tab=done")).text);

			const rendered = page.getElementById("readlist-unread-label");
			assert(rendered, "the readlist page must render the label the counts swap lands in");
			expect(rendered.hasAttribute("hx-preserve")).toBe(true);
			expect(rendered.textContent).toBe("To Read");

			const refreshed = fragment.getElementById("readlist-unread-label");
			assert(refreshed, "the counts fragment must carry the label it refreshes");
			expect(refreshed.getAttribute("hx-swap-oob")).toBe("innerHTML");
			expect(refreshed.hasAttribute("hx-preserve")).toBe(false);
			expect(refreshed.textContent).toBe("To Read (1)");
		});

		it("should be requested by the readlist page on load, carrying the reader's filters", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const page = new JSDOM((await agent.get("/queue?tab=done&order=asc")).text).window.document;

			const trigger = page.querySelector("[data-test-readlist-counts]");
			assert(trigger, "the readlist page must trigger the out-of-band counts request");
			expect(trigger.getAttribute("hx-trigger")).toBe("load");
			expect(trigger.getAttribute("hx-swap")).toBe("none");
			expect(trigger.getAttribute("hx-get")).toBe("/queue/counts?tab=done&order=asc");
		});
	});
});
