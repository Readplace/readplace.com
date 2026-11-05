import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

const PARKED = JSON.stringify({ kind: "awaiting-reader", deferredLeg: "content-judge" });
const EDGE_BLOCK = JSON.stringify({ kind: "blocked", cause: "edge-block" });
const CAPTURE_UNREADABLE = JSON.stringify({ kind: "capture-unreadable", detail: "none" });
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const EXTENSION_ALIVE = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`;

async function readerWithSave(url: string) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const created = await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the reader must be created");
	const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
	await agent.post("/login").type("form").send({ email: "reader@example.com", password: "password123" });
	await agent.post("/queue/save").type("form").send({ url });
	const listed = new JSDOM((await agent.get("/queue")).text).window.document;
	const articleId = listed.querySelector("article[data-test-article]")?.getAttribute("data-test-article");
	assert(articleId, "the saved article must be listed");
	const settle = async (status: "failed" | "unsupported", reason: string) => {
		await fixture.articleCrawl.forceMarkCrawlPending({ url });
		if (status === "failed") await fixture.articleCrawl.markCrawlFailed({ url, reason });
		else await fixture.articleCrawl.markCrawlUnsupported({ url, reason });
	};
	const commands = () =>
		fixture.resolutionOnView.publishedResolveArticleOnView.filter((command) => command.url === url);
	return { fixture, agent, articleId, settle, commands };
}

function readerRegions(html: string) {
	const doc = new JSDOM(html).window.document;
	return {
		slot: doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status"),
		notice: doc.querySelector("[data-test-reader-notice]")?.getAttribute("data-reader-status"),
	};
}

describe("opening the reader resolves the article it shows", () => {
	it("renders a parked article pending and publishes one reader command", async () => {
		const url = "https://example.com/parked";
		const { agent, articleId, settle, commands } = await readerWithSave(url);
		await settle("unsupported", PARKED);

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(readerRegions(response.text).slot).toBe("pending");
		expect(commands()).toEqual([expect.objectContaining({ url, axes: "crawl-and-summary", surface: "reader" })]);
	});

	it("publishes nothing when a bot opens the reader", async () => {
		const url = "https://example.com/bot-opened";
		const { agent, articleId, settle, commands } = await readerWithSave(url);
		await settle("unsupported", PARKED);

		await agent.get(`/queue/${articleId}/view`).set("User-Agent", GOOGLEBOT_UA);

		expect(commands()).toEqual([]);
	});

	it.each([
		{ route: "the reader render with ?poll", path: (id: string) => `/queue/${id}/view?poll=1` },
		{ route: "the markdown read link", path: (id: string) => `/queue/${id}/read` },
		{ route: "the card poll", path: (id: string) => `/queue/${id}/card` },
		{ route: "the reader poll", path: (id: string) => `/queue/${id}/reader?poll=2` },
		{ route: "the summary poll", path: (id: string) => `/queue/${id}/summary?poll=2` },
	])("publishes nothing from $route", async ({ path }) => {
		const url = "https://example.com/not-a-trigger";
		const { agent, articleId, settle, commands } = await readerWithSave(url);
		await settle("unsupported", PARKED);

		await agent.get(path(articleId));

		expect(commands()).toEqual([]);
	});

	it("claims an unreadable capture for a reader whose extension can capture", async () => {
		const url = "https://example.com/unreadable-capture";
		const { agent, articleId, settle, commands } = await readerWithSave(url);
		await settle("failed", CAPTURE_UNREADABLE);

		const response = await agent.get(`/queue/${articleId}/view`).set("Cookie", EXTENSION_ALIVE);

		expect(readerRegions(response.text).slot).toBe("pending");
		expect(commands()).toEqual([expect.objectContaining({ url, axes: "crawl-and-summary", surface: "reader" })]);
	});

	it("leaves an edge-blocked row to the extension that can capture it", async () => {
		const url = "https://example.com/edge-blocked";
		const { agent, articleId, settle, commands } = await readerWithSave(url);
		await settle("failed", EDGE_BLOCK);

		const response = await agent.get(`/queue/${articleId}/view`).set("Cookie", EXTENSION_ALIVE);

		expect(readerRegions(response.text).notice).toBe("blocked");
		expect(commands()).toEqual([]);
	});

	it("claims the paid legs when the device's gave-up poll arrives for an edge-blocked row", async () => {
		const url = "https://example.com/device-gave-up";
		const { fixture, agent, articleId, settle, commands } = await readerWithSave(url);
		await settle("failed", EDGE_BLOCK);
		const blocked = await fixture.articleCrawl.findArticleCrawlStatus(url);
		assert(blocked?.status === "failed", "the row must be failed before the device gives up");

		const response = await agent.get(
			`/queue/${articleId}/reader?poll=2&captureSince=${blocked.outcomeRevision}&captureGaveUp=1&captureTrigger=manual`,
		);

		expect(readerRegions(response.text).slot).toBe("pending");
		expect(commands()).toEqual([expect.objectContaining({ url, axes: "crawl-and-summary", surface: "reader-capture-gave-up" })]);
	});

	it("claims nothing when the device's gave-up poll arrives within the cool-down of an earlier claim", async () => {
		const url = "https://example.com/device-gave-up-again";
		const { fixture, agent, articleId, settle, commands } = await readerWithSave(url);
		const gaveUpPoll = async () => {
			const blocked = await fixture.articleCrawl.findArticleCrawlStatus(url);
			assert(blocked?.status === "failed", "the row must be failed before the device gives up");
			return agent.get(`/queue/${articleId}/reader?poll=2&captureSince=${blocked.outcomeRevision}&captureGaveUp=1&captureTrigger=manual`);
		};
		await settle("failed", EDGE_BLOCK);
		await gaveUpPoll();
		await settle("failed", EDGE_BLOCK);

		const response = await gaveUpPoll();

		expect(commands()).toHaveLength(1);
		expect(readerRegions(response.text)).toEqual({ slot: "capture-missing", notice: "capture-missing" });
	});
});
