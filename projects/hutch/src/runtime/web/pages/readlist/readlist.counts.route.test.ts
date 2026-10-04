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

const SWAPPED_COUNT_IDS = ["readlist-count", "readlist-pagination-info", "readlist-pages"];

function swappedTargets(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[hx-swap-oob]"), (element) => element.id);
}

function listingCount(doc: Document): Element {
	const count = doc.getElementById("readlist-count");
	assert(count, "the counts fragment must carry the listing count");
	return count;
}

async function save(agent: LoggedInAgent, url: string): Promise<void> {
	await agent.post("/queue/save").type("form").send({ url });
}

async function saveMany(agent: LoggedInAgent, count: number, prefix: string): Promise<void> {
	for (let i = 0; i < count; i++) {
		await save(agent, `${prefix}${i}`);
	}
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
		it("should answer with an HTML fragment carrying the listing count", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/a");
			await save(agent, "https://example.com/b");

			const response = await agent.get("/queue/counts");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toContain("text/html");
			const count = listingCount(parseFragment(response.text));
			expect(count.textContent).toBe("2 Saved Articles");
			expect(count.getAttribute("hx-swap-oob")).toBe("outerHTML");
		});

		it("should count zero for an empty readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue/counts");

			expect(listingCount(parseFragment(response.text)).textContent).toBe("0 Saved Articles");
		});

		it("should re-arm every count the listing shows, even on a single page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/only");

			const response = await agent.get("/queue/counts");

			const doc = parseFragment(response.text);
			expect(swappedTargets(doc)).toEqual(SWAPPED_COUNT_IDS);
			expect(listingCount(doc).textContent).toBe("1 Saved Article");
		});

		it("should fill in the total page count once the tab spans pages", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/page-");

			const response = await agent.get("/queue/counts");

			const info = parseFragment(response.text).querySelector("[data-test-pagination-info]");
			assert(info, "the counts fragment must carry the pagination info across pages");
			expect(info.textContent).toBe(`Showing ${READLIST_PAGE_SIZE} of ${READLIST_PAGE_SIZE + 1}`);
			expect(info.getAttribute("hx-swap-oob")).toBe("outerHTML");
			expect(info.getAttribute("id")).toBe("readlist-pagination-info");
		});

		it("should report the requested page in the pagination fragment", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/p-");

			const response = await agent.get("/queue/counts?page=2");

			const info = parseFragment(response.text).querySelector("[data-test-pagination-info]");
			expect(info?.textContent).toBe(`Showing 1 of ${READLIST_PAGE_SIZE + 1}`);
		});

		it("should count the Read tab, not the readlist, when asked for the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/r-");

			const response = await agent.get("/queue/counts?tab=done");

			const doc = parseFragment(response.text);
			expect(swappedTargets(doc)).toEqual(SWAPPED_COUNT_IDS);
			expect(listingCount(doc).textContent).toBe("0 Saved Articles");
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

		it("should scan the partition once on the To Read tab", async () => {
			const { fixture, counted } = fixtureRecordingCounts();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/one-scan");
			counted.length = 0;

			const response = await agent.get("/queue/counts");

			expect(listingCount(parseFragment(response.text)).textContent).toBe("1 Saved Article");
			expect(counted.map((query) => query.status)).toEqual(["unread"]);
		});

		it("should scan the partition once on the Read tab", async () => {
			const { fixture, counted } = fixtureRecordingCounts();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await save(agent, "https://example.com/two-scans");
			counted.length = 0;

			const response = await agent.get("/queue/counts?tab=done");

			expect(listingCount(parseFragment(response.text)).textContent).toBe("0 Saved Articles");
			expect(counted.map((query) => query.status)).toEqual(["read"]);
		});
	});

	describe("swapping into the rendered readlist", () => {
		it("should target elements the readlist page actually rendered", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/swap-");

			const page = new JSDOM((await agent.get("/queue")).text).window.document;
			const fragment = parseFragment((await agent.get("/queue/counts")).text);

			for (const id of ["readlist-count", "readlist-pagination-info"]) {
				const target = page.getElementById(id);
				const replacement = fragment.getElementById(id);
				assert(target, `the readlist page must render #${id} for the counts swap to land on`);
				assert(replacement, `the counts fragment must carry #${id}`);
				expect(replacement.tagName).toBe(target.tagName);
				expect(replacement.getAttribute("class")).toBe(target.getAttribute("class"));
			}
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

		it("should land each queue's counts fragment on the ids that queue's own page renders", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const created = await agent.post("/queue/queues");
			expect(created.status).toBe(303);
			const slug = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
			assert(slug, "creating a queue must land the reader on it");

			for (const query of ["", `?queue=${slug}`]) {
				const page = new JSDOM((await agent.get(`/queue${query}`)).text).window.document;
				const fragment = parseFragment((await agent.get(`/queue/counts${query}`)).text);
				expect(swappedTargets(fragment)).toEqual(SWAPPED_COUNT_IDS);
				for (const id of SWAPPED_COUNT_IDS) {
					assert(
						page.getElementById(id),
						`the /queue${query} page must render #${id} for its counts swap to land on`,
					);
				}
			}
		});
	});
});
