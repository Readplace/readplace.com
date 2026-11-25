import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { InboxAddressSchema, MessageIdSchema, EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

const useApp = useTestServer();
const useMeteredApp = useTestServer({ isDailyLimited: () => true });

const RECEIVED_AT_MESSAGE_ID = "2026-06-24T09:00:00.000Z#<issue-42@tldr.tech>";
const ENCODED_ID = encodeURIComponent(RECEIVED_AT_MESSAGE_ID);
const INBOX_PAGE = `${TEST_APP_ORIGIN}/inbox/${ENCODED_ID}`;

function issueUrlFor(userId: UserId): string {
	return `email://inbox/${encodeURIComponent(userId)}/${ENCODED_ID}`;
}

function parse(html: string) {
	return new JSDOM(html).window.document;
}

async function buildHarness(options: { extraction?: "finished" | "failed" | "pending"; dailySaveLimit?: number; thirdUrl?: string } = {}) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { dailySaveLimit } = options;
	if (dailySaveLimit !== undefined) {
		fixture.rateLimit = {
			...fixture.rateLimit,
			rules: { ...fixture.rateLimit.rules, dailySaves: { limit: dailySaveLimit, windowSeconds: 86_400 } },
		};
	}
	const harness = dailySaveLimit === undefined ? useApp(fixture) : useMeteredApp(fixture);
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
		saveTrigger: "manual",
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
			anchorText: undefined,
			...entry,
			ordinal: EmailLinkOrdinalSchema.parse(entry.ordinal),
		});
	await putLink({ ordinal: "0000", url: "https://a.test/first", status: "crawled", title: "The first story" });
	await putLink({ ordinal: "0001", url: "https://b.test/second" });
	await putLink({ ordinal: "0002", url: options.thirdUrl ?? "https://localhost/admin" });
	if (options.extraction === "failed") {
		await links.markLinksExtractionFailed({ userId, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID });
	} else if (options.extraction !== "pending") {
		await links.putLinksMeta({
			userId,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			meta: { truncated: false, extractionFailed: false },
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

it("records deliberate saves before rollout while withholding Hand Picked membership controls", async () => {
	const environment = jest.replaceProperty(process, "env", { ...process.env, HAND_PICKED_HOME_ENABLED: "false" });
	try {
		const { fixture, harness, agent, userId } = await buildHarness();
		const url = "https://a.test/deliberate-save";
		await agent.post("/queue/save").type("form").send({ url }).expect(303);
		const saved = await fixture.articleStore.findArticleByUrl(url);
		assert(saved);
		const collection = await agent.get("/queue").expect(200);
		const page = parse(collection.text);
		expect(page.querySelector(`[data-test-article="${saved.id.value}"]`)).not.toBeNull();
		expect(page.querySelector("form[action*='/hand-picked']")).toBeNull();

		const token = await saveAccessTokenForUser(harness, userId);
		const siren = (await request(harness.server).get("/queue")
			.set("Authorization", `Bearer ${token}`).set("Accept", SIREN_MEDIA_TYPE).expect(200)).body;
		expect(siren.entities.length).toBeGreaterThan(0);
		for (const article of siren.entities) {
			expect(article.actions).not.toContainEqual(expect.objectContaining({ name: expect.stringMatching(/-hand-picked$/) }));
		}
		await agent.post(`/queue/${saved.id.value}/hand-picked`).type("form").send({ membership: "remove" }).expect(404);
		await agent.get("/queue?scope=hand-picked").expect(404);
		await agent.post(`/queue/${saved.id.value}/delete?scope=hand-picked`).expect(404);
		expect((await fixture.articleStore.findArticleById(saved.id, userId))?.personalPickedAt).toBeDefined();
	} finally {
		environment.restore();
	}
});

it("filters All by source within the current tab and counts shared newsletter links once", async () => {
	const { fixture, agent, userId } = await buildHarness();
	const store = fixture.articleStore;
	const url = "https://a.test/first";
	const params = { userId, url, savedAt: new Date("2026-04-04"), provenance: { kind: "web" } as const,
		metadata: { title: "Shared story", siteName: "News", excerpt: "", wordCount: 80 },
		estimatedReadTime: MinutesSchema.parse(1), saveTrigger: "manual" as const };
	const { saved } = await store.saveArticle(params);
	await store.saveArticle({ ...params, url: "https://b.test/import", bulkSave: true });
	await store.saveArticle({ ...params, url: "https://b.test/uncertain" });
	store.seedUncertainSave({ userId, url: "https://b.test/uncertain" });
	const olderUrl = "https://a.test/older";
	const { saved: older } = await store.saveArticle({ ...params, url: olderUrl, savedAt: new Date("2026-04-03") });
	await store.updateArticleStatus(older.id, userId, "read");
	await store.updateArticleStatus(saved.id, userId, "read");
	for (const sender of ["first@example.org", "second@example.org"]) {
		const messageId = MessageIdSchema.parse(`<issue-${sender}>`);
		const receivedAt = "2026-04-05T00:00:00.000Z";
		const receivedAtMessageId = `${receivedAt}#${messageId}`;
		await fixture.inboxEmail.inboxEmailStore.putEmail({ userId, senderEmail: sender, receivedAt, messageId, receivedAtMessageId,
			recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"), subject: "Weekly", status: "received", rawEmailS3Key: "raw", bodyS3Key: "body", linkCounts: undefined });
		for (const [ordinal, linkedUrl] of [["0000", url], ["0001", url], ["0002", olderUrl]]) {
			await fixture.inboxEmail.inboxEmailLinkStore.putLink({ userId, receivedAtMessageId, ordinal: EmailLinkOrdinalSchema.parse(ordinal),
				url: linkedUrl, resolvedUrl: undefined, status: "pending", title: undefined, excerpt: undefined, siteName: undefined, imageUrl: undefined, failureReason: undefined, skipReason: undefined, anchorText: undefined });
		}
		const result = await agent.get("/queue").query({ source: "sender", sender, tab: "done" }).expect(200);
		expect([...parse(result.text).querySelectorAll("[data-test-article]")].map(card => card.getAttribute("data-test-article")).sort())
			.toEqual([saved.id.value, older.id.value].sort());
		const redirect = await agent.get("/queue").query({ source: "sender", sender, tab: "done", page: "2" }).expect(302);
		const back = new URL(redirect.headers.location, TEST_APP_ORIGIN);
		expect(back.searchParams.get("sender")).toBe(sender);
		const unread = await agent.get("/queue").query({ source: "sender", sender }).expect(200);
		expect(parse(unread.text).querySelectorAll("[data-test-article]")).toHaveLength(0);
	}
	for (const source of ["bulk", "unknown"]) {
		const listing = parse((await agent.get("/queue").query({ source }).expect(200)).text);
		expect(listing.querySelectorAll("[data-test-article]")).toHaveLength(1);
		expect(listing.querySelector("details.readlist__manage[open] details.menu")).toBeTruthy();
		const stalePage = await agent.get("/queue").query({ source, page: 2 }).expect(302);
		expect(new URL(stalePage.headers.location, TEST_APP_ORIGIN).searchParams.get("source")).toBe(source);
	}
});

it("reviews an ambiguous older save from Hand Picked and closes its review card after a decision", async () => {
	const { agent, fixture, userId } = await buildHarness();
	const url = "https://example.org/older";
	const { saved } = await fixture.articleStore.saveArticle({
		userId, url, savedAt: new Date("2025-01-01"), provenance: { kind: "web" }, saveTrigger: "manual",
		metadata: { title: "An older article", siteName: "", excerpt: "", wordCount: 0 }, estimatedReadTime: MinutesSchema.parse(1),
	});
	fixture.articleStore.seedUncertainSave({ userId, url });
	const home = parse((await agent.get("/queue?scope=hand-picked").expect(200)).text);
	const review = [...home.querySelectorAll("a")].find(link => link.textContent?.trim() === "Review older saves in All");
	const href = review?.getAttribute("href");
	assert(href);
	const listing = parse((await agent.get(href).expect(200)).text);
	expect(listing.querySelectorAll("[data-test-article]")).toHaveLength(1);
	const card = `/queue/${saved.id.value}/card?review=older`;
	await agent.get(card).expect(200);
	await agent.post(`/queue/${saved.id.value}/hand-picked?review=older`).type("form").send({ membership: "remove" }).expect(303);
	await agent.get(card).expect(404);
	expect((await fixture.articleStore.findArticleById(saved.id, userId))?.status).toBe("unread");
});

it("preserves a nine-link issue and a read article through pick, redelivery and unpick", async () => {
	const { fixture, agent, userId, putLink, issueId } = await buildHarness({ thirdUrl: "https://news.example/2" });
	for (let index = 3; index < 9; index++) {
		await putLink({ ordinal: String(index).padStart(4, "0"), url: `https://news.example/${index}` });
	}
	const article = {
		userId, url: "https://a.test/first",
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" } as const,
		metadata: { title: "First story", excerpt: "", siteName: "Weekly", wordCount: 480 },
		estimatedReadTime: MinutesSchema.parse(2), saveTrigger: "automatic" as const,
	};
	const store = fixture.articleStore;
	const { saved } = await store.saveArticle({ ...article, savedAt: new Date("2026-06-24") });
	const read = await store.updateArticleStatus(saved.id, userId, "read");
	const membership = `/queue/${saved.id.value}/hand-picked`;
	const picked = { userId, personalScope: "picked", status: "read" } as const;
	await agent.post(membership).type("form").send({ membership: "add" }).expect(303);
	const firstPick = (await store.findArticleById(saved.id, userId))?.personalPickedAt;
	expect(firstPick).toBeDefined();
	await store.saveArticle({ ...article, savedAt: new Date("2026-06-25") });
	expect(await store.findArticleById(saved.id, userId)).toMatchObject({ status: "read", personalPickedAt: firstPick, readAt: read?.readAt });
	expect(await store.countArticlesByUser(picked)).toBe(1);
	await agent.post(membership).type("form").send({ membership: "remove" }).expect(303);
	await store.saveArticle({ ...article, savedAt: new Date("2026-06-26") });
	expect(await store.countArticlesByUser(picked)).toBe(0);
	expect(await store.countArticlesByUser({ userId, status: "read" })).toBe(1);
	expect(panelOf((await agent.get(`/queue/${issueId}/view`)).text).rows).toHaveLength(9);
});

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

	function assertSharingOff(doc: Document, popovers: readonly string[]) {
		assert.deepEqual(
			Array.from(doc.querySelectorAll(".article-body__actions--top > *"), (slot) => {
				const block = slot.classList.item(0);
				return slot.classList.contains(`${block}--hidden`) ? `${block} (hidden)` : block;
			}),
			[
				"article-body__back-slot",
				"article-body__readlists-slot",
				"article-body__mark-read-slot",
				"article-body__share-slot",
				"article-body__downloads-slot",
				"article-body__more-slot",
			],
		);
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-test-reader-menu-panel] > *"), (item) => {
				const block = item.classList.item(0);
				return item.classList.contains(`${block}--hidden`) ? `${block} (hidden)` : block;
			}),
			["article-body__menu-slot", "article-body__menu-slot", "article-delete__form", "menu__item"],
		);
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-test-confirm-popover]"), (popover) =>
				popover.getAttribute("data-test-confirm-popover"),
			),
			popovers,
		);
		assert.deepEqual(
			Array.from(
				doc.querySelectorAll(
					'[data-test-action="share-withheld"], [data-test-action="download-withheld"], [data-test-action="menu-share-withheld"], [data-test-action="menu-download-withheld"]',
				),
				(trigger) => [
					trigger.getAttribute("data-test-action"),
					trigger.getAttribute("popovertarget"),
					trigger.getAttribute("aria-disabled"),
				],
			),
			[
				["share-withheld", "reader-sharing-off", "true"],
				["download-withheld", "reader-sharing-off", "true"],
				["menu-share-withheld", "reader-sharing-off", "true"],
				["menu-download-withheld", "reader-sharing-off", "true"],
			],
		);
		const html = doc.documentElement.outerHTML;
		assert.deepEqual(
			[html.includes("/view/inbox/"), html.includes("format=epub"), doc.querySelectorAll("[data-share-url]").length],
			[false, false, 0],
		);
	}

	it("dims Share and the EPUB download on a private newsletter issue, both opening the dialog that says why", async () => {
		const { agent, issueId } = await buildHarness();

		const doc = parse((await agent.get(`/queue/${issueId}/view`)).text);

		assertSharingOff(doc, ["highlight-note", "exit-confirm", "delete", "sharing-off", "readlist-create"]);
	});

	it("dims Share and the EPUB download on a private newsletter issue in the app's chromeless reader", async () => {
		const { agent, issueId } = await buildHarness();

		const doc = parse((await agent.get(`/queue/${issueId}/view?shell=app`)).text);

		assert.equal(doc.body.classList.contains("page-reader--chromeless"), true);
		assertSharingOff(doc, ["highlight-note", "exit-confirm", "delete", "sharing-off", "readlist-create"]);
	});

	it("swaps no EPUB download in when a reader poll for an issue settles", async () => {
		const { agent, issueId } = await buildHarness();

		const response = await agent.get(`/queue/${issueId}/reader?poll=1`);

		const ids = Array.from(parse(response.text).querySelectorAll("[hx-swap-oob]")).map((el) => el.id);
		assert.deepEqual(ids, [
			"highlights-rail",
			"article-body-summary-slot",
			"table-of-contents",
			"reader-article-title",
			"reader-article-meta",
			"document-title",
			"article-body-reader-notice",
		]);
	});

	it("answers someone else's request for an issue's reader as not found", async () => {
		const { harness, issueId } = await buildHarness();

		const response = await request(harness.server).get(`/queue/${issueId}/view`);

		expect(response.status).toBe(404);
	});
});

describe("Saving a link from an issue (POST /queue/:id/issue-links)", () => {
	it("returns to the issue with a daily-limit flag and saves nothing once a metered account's new saves are spent", async () => {
		const { agent, fixture, harness, issueId } = await buildHarness({ dailySaveLimit: 0 });

		const response = await agent
			.post(`/queue/${issueId}/issue-links`)
			.type("form")
			.send({ ordinal: "0001", returnTo: `/queue/${issueId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${issueId}/view?issue_link_daily_limit=0001#issue-links`);
		assert.equal(await fixture.articleStore.findArticleByUrl("https://b.test/second"), null);
		expect(harness.analytics.events).toContainEqual(
			expect.objectContaining({ event: "save_refused", code: "daily_save_limit", path: "/queue/:id/issue-links" }),
		);
	});

	it("tells the reader the day's new saves are spent when the refused save returns to the issue", async () => {
		const { agent, issueId } = await buildHarness({ dailySaveLimit: 0 });
		const refused = await agent
			.post(`/queue/${issueId}/issue-links`)
			.type("form")
			.send({ ordinal: "0001", returnTo: `/queue/${issueId}/view` });

		const page = await agent.get(refused.headers.location);

		const notice = new JSDOM(page.text).window.document.querySelector("[data-test-issue-links-daily-limit]");
		assert(notice, "the issue-links panel must show the daily-limit notice");
		expect(notice.textContent).toBe("You've reached today's limit for new saves.");
	});

	it("saves a metered account's issue link while the day's allowance lasts", async () => {
		const { agent, fixture, issueId } = await buildHarness({ dailySaveLimit: 1 });

		const response = await agent
			.post(`/queue/${issueId}/issue-links`)
			.type("form")
			.send({ ordinal: "0001", returnTo: `/queue/${issueId}/view` });

		expect(response.headers.location).toBe(`/queue/${issueId}/view?issue_link_saved=0001#issue-links`);
		assert(await fixture.articleStore.findArticleByUrl("https://b.test/second"), "the link is saved");
	});

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
		const { agent, fixture, userId, putLink, issueId } = await buildHarness();
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
		assert.deepEqual(fixture.publishedQueueEntryCreated, [{ url: publisher, userId }]);
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
				personalPickAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
				saveTrigger: "manual",
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
