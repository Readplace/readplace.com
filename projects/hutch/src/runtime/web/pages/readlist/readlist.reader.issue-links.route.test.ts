import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const RECEIVED_AT_MESSAGE_ID = "2026-06-24T09:00:00.000Z#<issue-42@tldr.tech>";
const ENCODED_ID = encodeURIComponent(RECEIVED_AT_MESSAGE_ID);
const INBOX_PAGE = `${TEST_APP_ORIGIN}/inbox/${ENCODED_ID}`;

function issueUrlFor(userId: UserId): string {
	return `email://inbox/${encodeURIComponent(userId)}/${ENCODED_ID}`;
}

function parse(html: string) {
	return new JSDOM(html).window.document;
}

async function buildHarness(options: { extraction?: "finished" | "failed" | "pending" } = {}) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const signedInUser = await fixture.auth.findUserByEmail("test@example.com");
	assert(signedInUser, "loginAgent creates the user it signs in as");
	const { userId } = signedInUser;
	const issueUrl = issueUrlFor(userId);
	const links = fixture.inboxEmail.inboxEmailLinkStore;

	await fixture.articleStore.saveArticle({
		userId,
		url: issueUrl,
		metadata: { title: "TLDR 2026-06-24", siteName: "TLDR", excerpt: "Today's links", wordCount: 480 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		savedAt: new Date("2026-06-24T09:01:00.000Z"),
	});
	await fixture.articleStore.setDisplayUrl({ url: issueUrl, displayUrl: INBOX_PAGE });
	await fixture.articleStore.writeContent({ url: issueUrl, content: "<p>Today's links, with commentary.</p>" });
	await fixture.articleCrawl.markCrawlReady({ url: issueUrl });
	const issue = await fixture.articleStore.findArticleByUrl(issueUrl);
	assert(issue, "the seeded issue is saved");

	const putLink = async (entry: Omit<Partial<InboxEmailLinkEntry>, "ordinal"> & { ordinal: string; url: string }) =>
		links.putLink({
			userId,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			resolvedUrl: undefined,
			status: "pending",
			title: undefined,
			excerpt: undefined,
			siteName: undefined,
			imageUrl: undefined,
			failureReason: undefined,
			skipReason: undefined,
			droppedFor: undefined,
			...entry,
			ordinal: EmailLinkOrdinalSchema.parse(entry.ordinal),
		});
	await putLink({ ordinal: "0000", url: "https://a.test/first", status: "crawled", title: "The first story" });
	await putLink({ ordinal: "0001", url: "https://b.test/second" });
	await putLink({ ordinal: "0002", url: "https://localhost/admin" });
	if (options.extraction === "failed") {
		await links.markLinksExtractionFailed({ userId, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID });
	} else if (options.extraction !== "pending") {
		await links.putLinksMeta({
			userId,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			meta: { truncated: false, extractionFailed: false, readlistDecision: undefined },
		});
	}

	return { fixture, harness, agent, userId, putLink, issueId: issue.id.value };
}

function panelOf(html: string) {
	const panel = parse(html).querySelector("[data-test-reader-issue-links]");
	assert(panel, "the reader always renders the issue links panel");
	return {
		state: panel.getAttribute("data-issue-links-state"),
		rows: Array.from(panel.querySelectorAll("[data-test-issue-link]")).map((row) => [
			row.getAttribute("data-test-issue-link"),
			row.querySelector("[data-test-issue-link-save-state]")?.getAttribute("data-test-issue-link-save-state"),
		]),
	};
}

describe("Links in this issue (GET /queue/:id/view)", () => {
	it("lists the issue's article links under its body, each ready to save", async () => {
		const { agent, issueId } = await buildHarness();

		const response = await agent.get(`/queue/${issueId}/view`);

		expect(response.status).toBe(200);
		assert.deepEqual(panelOf(response.text), {
			state: "ready",
			rows: [
				["0000", "unsaved"],
				["0001", "unsaved"],
			],
		});
	});

	it("marks a link the reader already saved from the inbox as saved", async () => {
		const { agent, fixture, userId, issueId } = await buildHarness();
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({ userId, url: "https://b.test/second" });

		const response = await agent.get(`/queue/${issueId}/view`);

		assert.deepEqual(panelOf(response.text).rows, [
			["0000", "unsaved"],
			["0001", "saved"],
		]);
	});

	it("says the links are still being found before the issue's links are read", async () => {
		const { agent, issueId } = await buildHarness({ extraction: "pending" });

		const response = await agent.get(`/queue/${issueId}/view`);

		assert.equal(panelOf(response.text).state, "extracting");
	});

	it("says the issue's links could not be read when reading them gave up", async () => {
		const { agent, issueId } = await buildHarness({ extraction: "failed" });

		const response = await agent.get(`/queue/${issueId}/view`);

		assert.equal(panelOf(response.text).state, "failed");
	});

	it("keeps the panel hidden on an ordinary article", async () => {
		const { agent, fixture } = await buildHarness();
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/ordinary" });
		const ordinary = await fixture.articleStore.findArticleByUrl("https://example.com/ordinary");
		assert(ordinary, "saving creates the article");

		const response = await agent.get(`/queue/${ordinary.id.value}/view`);

		assert.equal(panelOf(response.text).state, "absent");
	});

	it("withholds the share prompt and the EPUB download from a private newsletter issue", async () => {
		const { agent, issueId } = await buildHarness();

		const doc = parse((await agent.get(`/queue/${issueId}/view`)).text);

		assert.deepEqual(
			[
				doc.querySelector("[data-test-reader-float-stack]")?.getAttribute("data-test-reader-share"),
				doc.querySelector("[data-test-downloads-slot]")?.classList.contains("article-body__downloads-slot--hidden"),
			],
			["withheld", true],
		);
	});

	it("swaps no EPUB download in when a reader poll for an issue settles", async () => {
		const { agent, issueId } = await buildHarness();

		const response = await agent.get(`/queue/${issueId}/reader?poll=1`);

		const ids = Array.from(parse(response.text).querySelectorAll("[hx-swap-oob]")).map((el) => el.id);
		assert.deepEqual(ids, ["article-body-summary-slot", "article-body-progress", "article-header", "document-title"]);
	});

	it("answers someone else's request for an issue's reader as not found", async () => {
		const { harness, issueId } = await buildHarness();

		const response = await request(harness.server).get(`/queue/${issueId}/view`);

		expect(response.status).toBe(404);
	});
});

describe("Saving a link from an issue (POST /queue/:id/issue-links)", () => {
	it("saves the link into All with the newsletter as where it came from, and returns to the issue with the link marked saved", async () => {
		const { agent, fixture, userId, issueId } = await buildHarness();

		const response = await agent
			.post(`/queue/${issueId}/issue-links`)
			.type("form")
			.send({ ordinal: "0001", returnTo: `/queue/${issueId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${issueId}/view?issue_link_saved=0001#issue-links`);
		const saved = await fixture.articleStore.findArticleByUrl("https://b.test/second");
		assert(saved, "the link is saved as an article");
		const owned = await fixture.articleStore.findArticleById(saved.id, userId);
		assert.deepEqual(owned?.provenance, { kind: "email", senderEmail: "dan@tldr.tech" });
		const back = await agent.get(response.headers.location.replace("#issue-links", ""));
		assert.deepEqual(panelOf(back.text).rows, [
			["0000", "unsaved"],
			["0001", "saved"],
		]);
	});

	it("saves a newsletter click-tracker link under the publisher it resolves to", async () => {
		const { agent, fixture, putLink, issueId } = await buildHarness();
		const tracker = "https://javascriptweekly.com/link/100000/rss";
		const publisher = "https://sqlite.org/lang_with.html";
		await putLink({ ordinal: "0003", url: tracker });
		fixture.wrapperTarget.targets.set(tracker, publisher);

		const response = await agent.post(`/queue/${issueId}/issue-links`).type("form").send({ ordinal: "0003" });

		expect(response.status).toBe(303);
		assert.equal(await fixture.articleStore.findArticleByUrl(tracker), null);
		const saved = await fixture.articleStore.findArticleByUrl(publisher);
		assert.equal(saved?.url, publisher);
		assert.deepEqual(fixture.submitLink.submitLinks, []);
	});

	it("queues a click-tracker link whose publisher cannot be resolved, writing no article for the tracker", async () => {
		const { agent, fixture, userId, putLink, issueId } = await buildHarness();
		const tracker = "https://javascriptweekly.com/link/100000/rss";
		await putLink({ ordinal: "0003", url: tracker });

		const response = await agent.post(`/queue/${issueId}/issue-links`).type("form").send({ ordinal: "0003" });

		expect(response.status).toBe(303);
		assert.equal(await fixture.articleStore.findArticleByUrl(tracker), null);
		expect(fixture.submitLink.submitLinks).toEqual([
			{
				url: tracker,
				userId,
				provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
				readlist: "default",
				saveAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			},
		]);
	});

	it.each([
		{ case: "a link that is not in the issue", ordinal: "0009" },
		{ case: "a malformed link number", ordinal: "first" },
		{ case: "a link that cannot be saved as an article", ordinal: "0002" },
	])("refuses $case", async ({ ordinal }) => {
		const { agent, issueId } = await buildHarness();

		const response = await agent.post(`/queue/${issueId}/issue-links`).type("form").send({ ordinal });

		expect(response.status).toBe(404);
	});

	it("refuses an article that is not a newsletter issue", async () => {
		const { agent, fixture } = await buildHarness();
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/ordinary" });
		const ordinary = await fixture.articleStore.findArticleByUrl("https://example.com/ordinary");
		assert(ordinary, "saving creates the article");

		const response = await agent.post(`/queue/${ordinary.id.value}/issue-links`).type("form").send({ ordinal: "0000" });

		expect(response.status).toBe(404);
	});

	it.each([
		{ case: "an article the reader does not have", id: "0123456789abcdef0123456789abcdef" },
		{ case: "a malformed article id", id: "not-an-id" },
	])("refuses $case", async ({ id }) => {
		const { agent } = await buildHarness();

		const response = await agent.post(`/queue/${id}/issue-links`).type("form").send({ ordinal: "0000" });

		expect(response.status).toBe(404);
	});
});
