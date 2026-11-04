import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import type { BuiltInOAuthClientId } from "@packages/supported-clients";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, createFakeSummaryProvider } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { saveAccessTokenForClient } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

const PARKED = JSON.stringify({ kind: "awaiting-reader", deferredLeg: "content-judge" });
const EDGE_BLOCK = JSON.stringify({ kind: "blocked", cause: "edge-block" });
const NOT_FOUND = JSON.stringify({ kind: "not-found", httpStatus: 404 });
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

async function readerWithSaves(urls: readonly string[], summary = createFakeSummaryProvider({ findItemOwner: async () => undefined })) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp({ ...fixture, summary });
	const created = await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the reader must be created");
	const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
	await agent.post("/login").type("form").send({ email: "reader@example.com", password: "password123" });
	for (const url of urls) {
		await agent.post("/queue/save").type("form").send({ url });
	}
	const park = async (url: string) => {
		await fixture.articleCrawl.forceMarkCrawlPending({ url });
		await fixture.articleCrawl.markCrawlUnsupported({ url, reason: PARKED });
	};
	const fail = async (url: string, reason: string) => {
		await fixture.articleCrawl.forceMarkCrawlPending({ url });
		await fixture.articleCrawl.markCrawlFailed({ url, reason });
	};
	const commandsFor = (url: string) =>
		fixture.resolutionOnView.publishedResolveArticleOnView.filter((command) => command.url === url);
	const sirenAs = async (clientId: BuiltInOAuthClientId, userAgent = BROWSER_USER_AGENT, query: Record<string, string> = {}) => {
		const token = await saveAccessTokenForClient(harness, { userId: created.userId, clientId });
		return request(harness.server)
			.get("/queue")
			.query(query)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("User-Agent", userAgent);
	};
	return { fixture, summary, harness, agent, park, fail, commandsFor, sirenAs };
}

function cardFor(html: string, url: string): Element {
	const doc = new JSDOM(html).window.document;
	const card = Array.from(doc.querySelectorAll("article[data-test-article]")).find(
		(candidate) => candidate.querySelector("[data-test-article-url]")?.getAttribute("href") === url,
	);
	assert(card, `the readlist must show a card for ${url}`);
	return card;
}

function sirenEntityFor(
	body: { entities: { properties: { url: string; contentVersion: string; needsBrowserCapture: boolean } }[] },
	url: string,
) {
	const entity = body.entities.find((candidate) => candidate.properties.url === url);
	assert(entity, `the collection must carry an entity for ${url}`);
	return entity;
}

describe("the queue list resolves a parked article a reader sees", () => {
	it("renders the parked card pending and publishes one readlist-html command", async () => {
		const url = "https://example.com/parked";
		const { agent, park, commandsFor } = await readerWithSaves([url]);
		await park(url);

		const card = cardFor((await agent.get("/queue")).text, url);

		expect(card.getAttribute("data-card-status")).toBe("pending");
		expect(card.getAttribute("hx-get")).toContain("/card");
		expect(commandsFor(url)).toEqual([expect.objectContaining({ url, axes: "crawl-and-summary", surface: "readlist-html" })]);
	});

	it("publishes nothing for a second render while the first claim holds the row", async () => {
		const url = "https://example.com/claimed";
		const { agent, park, commandsFor } = await readerWithSaves([url]);
		await park(url);
		await agent.get("/queue");

		const card = cardFor((await agent.get("/queue")).text, url);

		expect(card.getAttribute("data-card-status")).toBe("pending");
		expect(commandsFor(url)).toHaveLength(1);
	});

	it("resolves a row once a later page shows it", async () => {
		const urls = Array.from({ length: 21 }, (_, index) => `https://example.com/p-${index}`);
		const { agent, park, commandsFor } = await readerWithSaves(urls);
		await park("https://example.com/p-0");

		await agent.get("/queue");
		const beforePaging = commandsFor("https://example.com/p-0").length;
		await agent.get("/queue?page=2");

		expect(beforePaging).toBe(0);
		expect(commandsFor("https://example.com/p-0")).toEqual([expect.objectContaining({ surface: "readlist-html" })]);
	});

	it("resolves a row once a tab change shows it", async () => {
		const url = "https://example.com/read-earlier";
		const { agent, park, commandsFor } = await readerWithSaves([url]);
		const articleId = cardFor((await agent.get("/queue")).text, url).getAttribute("data-test-article");
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });
		await park(url);

		await agent.get("/queue");
		const beforeTab = commandsFor(url).length;
		await agent.get("/queue?status=read");

		expect(beforeTab).toBe(0);
		expect(commandsFor(url)).toEqual([expect.objectContaining({ surface: "readlist-html" })]);
	});

	it("publishes nothing for a bot", async () => {
		const url = "https://example.com/bot-seen";
		const { agent, park, commandsFor } = await readerWithSaves([url]);
		await park(url);

		const card = cardFor((await agent.get("/queue").set("User-Agent", GOOGLEBOT_UA)).text, url);

		expect(card.getAttribute("data-card-status")).not.toBe("pending");
		expect(commandsFor(url)).toEqual([]);
	});

	it("publishes nothing for a prefetch", async () => {
		const url = "https://example.com/prefetched";
		const { agent, park, commandsFor } = await readerWithSaves([url]);
		await park(url);

		await agent.get("/queue").set("Sec-Purpose", "prefetch");

		expect(commandsFor(url)).toEqual([]);
	});

	it("never claims a webmail row, a too-short summary or a not-found row", async () => {
		const webmail = "https://mail.google.com/mail/u/0/";
		const tooShort = "https://example.com/too-short";
		const gone = "https://example.com/gone";
		const { fixture, summary, agent, park, fail, commandsFor } = await readerWithSaves([webmail, tooShort, gone]);
		await park(webmail);
		await fixture.articleCrawl.markCrawlReady({ url: tooShort });
		summary.markSummarySkipped({ url: tooShort, reason: "content-too-short" });
		await fail(gone, NOT_FOUND);

		await agent.get("/queue");

		expect([...commandsFor(webmail), ...commandsFor(tooShort), ...commandsFor(gone)]).toEqual([]);
	});
});

describe("the Siren queue list resolves a parked article a client sees", () => {
	it("publishes one readlist-siren command and answers with the claimed state", async () => {
		const url = "https://example.com/siren-parked";
		const { fixture, park, commandsFor, sirenAs } = await readerWithSaves([url]);
		await park(url);
		const unclaimed = await sirenAs("hutch-firefox-extension", GOOGLEBOT_UA);

		const claimed = await sirenAs("hutch-firefox-extension");
		const after = await sirenAs("hutch-firefox-extension");

		expect(commandsFor(url)).toEqual([expect.objectContaining({ url, axes: "crawl-and-summary", surface: "readlist-siren" })]);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(url)).toEqual(expect.objectContaining({ status: "pending" }));
		expect(sirenEntityFor(claimed.body, url).properties).toEqual(
			expect.objectContaining({ contentVersion: sirenEntityFor(after.body, url).properties.contentVersion }),
		);
		expect(sirenEntityFor(claimed.body, url).properties).not.toEqual(
			expect.objectContaining({ contentVersion: sirenEntityFor(unclaimed.body, url).properties.contentVersion }),
		);
	});
});

describe("the Siren saved-state lookup for one url", () => {
	it("claims nothing for a url-filtered collection, while the unfiltered collection still claims the row", async () => {
		const url = "https://example.com/siren-lookup-failed";
		const { fixture, fail, commandsFor, sirenAs } = await readerWithSaves([url]);
		await fail(url, JSON.stringify({ kind: "parse-error", detail: "no readable article candidate" }));

		const lookup = await sirenAs("hutch-chrome-extension", BROWSER_USER_AGENT, { url });
		const commandsAfterLookup = [...commandsFor(url)];
		const crawlAfterLookup = await fixture.articleCrawl.findArticleCrawlStatus(url);
		await sirenAs("hutch-chrome-extension");

		expect({
			lookupStatus: lookup.status,
			lookupEntityUrl: sirenEntityFor(lookup.body, url).properties.url,
			commandsAfterLookup,
			crawlAfterLookup: crawlAfterLookup?.status,
			commandsAfterList: commandsFor(url),
		}).toEqual({
			lookupStatus: 200,
			lookupEntityUrl: url,
			commandsAfterLookup: [],
			crawlAfterLookup: "failed",
			commandsAfterList: [expect.objectContaining({ url, surface: "readlist-siren" })],
		});
	});
});

describe("a capture-capable viewer leaves a blocked row to the device", () => {
	it("publishes nothing when the extension's alive cookie is present", async () => {
		const url = "https://example.com/edge-blocked";
		const { agent, fail, commandsFor } = await readerWithSaves([url]);
		await fail(url, EDGE_BLOCK);

		const card = cardFor((await agent.get("/queue").set("Cookie", `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}`)).text, url);

		expect(card.getAttribute("data-card-status")).not.toBe("pending");
		expect(commandsFor(url)).toEqual([]);
	});

	it.each<BuiltInOAuthClientId>(["hutch-firefox-extension", "ios-app"])("publishes nothing for a Siren read from %s", async (clientId) => {
		const url = "https://example.com/edge-blocked-siren";
		const { fail, commandsFor, sirenAs } = await readerWithSaves([url]);
		await fail(url, EDGE_BLOCK);

		const response = await sirenAs(clientId);

		expect(sirenEntityFor(response.body, url).properties).toEqual(expect.objectContaining({ needsBrowserCapture: true }));
		expect(commandsFor(url)).toEqual([]);
	});

	it("claims the blocked row for a plain browser", async () => {
		const url = "https://example.com/edge-blocked-browser";
		const { agent, fail, commandsFor } = await readerWithSaves([url]);
		await fail(url, EDGE_BLOCK);

		const card = cardFor((await agent.get("/queue")).text, url);

		expect(card.getAttribute("data-card-status")).toBe("pending");
		expect(commandsFor(url)).toEqual([expect.objectContaining({ surface: "readlist-html" })]);
	});
});
