import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MinutesSchema } from "@packages/domain/article";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailLinksMeta,
	type InboxReadlistOutcome,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { ReadlistPurposeVersionSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<fit@x>";
const WORK = ReadlistSlugSchema.parse("work");
const PURPOSE_VERSION = ReadlistPurposeVersionSchema.parse("0123456789ab");
const KEPT_URL = "https://example.com/refactoring";
const DROPPED_URL = "https://example.com/launch";
const ONE_DAY_MS = 86_400_000;
const detailPath = `/inbox/${encodeURIComponent(SK)}`;

type Fixture = ReturnType<typeof createDefaultTestAppFixture>;

const FILTERED: InboxReadlistOutcome = {
	readlist: WORK,
	readlistLabel: "Work",
	decision: "filtered",
	fit: [
		{ ordinal: EmailLinkOrdinalSchema.parse("0000"), verdict: "keep", reason: "Engineering practice" },
		{ ordinal: EmailLinkOrdinalSchema.parse("0001"), verdict: "drop", reason: "A product launch" },
	],
	purposeVersion: PURPOSE_VERSION,
};

const ROUTED_META: InboxEmailLinksMeta = {
	truncated: false,
	extractionFailed: false,
	selectedReadlists: [{ readlist: WORK, label: "Work" }],
	eligibleArticleCount: 2,
	savesHeld: false,
};

function link(userId: UserId, overrides: Partial<InboxEmailLinkEntry>): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: KEPT_URL,
		resolvedUrl: undefined,
		status: "crawled",
		title: "Refactoring in small steps",
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		anchorText: undefined,
		...overrides,
	};
}

function email(userId: UserId): InboxEmailEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		messageId: MessageIdSchema.parse("<fit@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/fit",
		bodyS3Key: "content/fit/content.html",
		linkCounts: undefined,
	};
}

async function seed(
	fixture: Fixture,
	input: {
		meta?: InboxEmailLinksMeta;
		outcome?: InboxReadlistOutcome;
		withEmail?: boolean;
		links?: Partial<InboxEmailLinkEntry>[];
	} = {},
): Promise<UserId> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	const userId = user.userId;
	if (input.withEmail !== false) await fixture.inboxEmail.inboxEmailStore.putEmail(email(userId));
	const links = input.links ?? [
		{ ordinal: EmailLinkOrdinalSchema.parse("0000"), url: KEPT_URL, anchorText: "Refactoring" },
		{ ordinal: EmailLinkOrdinalSchema.parse("0001"), url: DROPPED_URL, title: "Our spring launch" },
	];
	for (const entry of links) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLink(link(userId, entry));
	}
	await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
		userId,
		receivedAtMessageId: SK,
		meta: input.meta ?? ROUTED_META,
	});
	const outcome = "outcome" in input ? input.outcome : FILTERED;
	if (outcome !== undefined) {
		await fixture.inboxEmail.inboxEmailLinkStore.putReadlistOutcome({
			userId,
			receivedAtMessageId: SK,
			outcome,
		});
	}
	return userId;
}

async function saveInto(fixture: Fixture, input: { userId: UserId; url: string }) {
	const params = {
		userId: input.userId,
		url: input.url,
		metadata: { title: "Saved", siteName: "example.com", excerpt: "Saved", wordCount: 300 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: { kind: "email" as const, senderEmail: "news@example.com" },
		savedAt: new Date("2026-06-24T09:01:00.000Z"),
	};
	await fixture.articleStore.saveArticle(params);
	await fixture.articleStore.saveReadlistArticle({ ...params, readlist: WORK });
}

const countWork = (fixture: Fixture, userId: UserId) =>
	fixture.articleStore.countReadlistArticles({ userId, readlist: WORK });

const fitPath = (ordinal: string, query = "") =>
	`/inbox/${encodeURIComponent(SK)}/links/${ordinal}/fit${query}`;

async function setUp(input: Parameters<typeof seed>[1] = {}, now = new Date("2026-06-25T10:00:00.000Z")) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => now;
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const userId = await seed(fixture, input);
	const choose = (ordinal: string, verdict: string, query = "") =>
		agent.post(fitPath(ordinal, query)).type("form").send({ readlist: "work", verdict });
	const overrides = () => fixture.articleStore.listReadlistFitOverrides({ userId, readlist: WORK });
	return { fixture, harness, agent, userId, choose, overrides };
}

function parseDoc(html: string) {
	return new JSDOM(html).window.document;
}

describe("Inbox link fit route", () => {
	it("files a link the engine dropped into the readlist as the reader's keep and remembers the choice", async () => {
		const { harness, userId, choose, overrides } = await setUp();

		const response = await choose("0001", "keep");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${detailPath}?fit=keep&in=work&link=0001`);
		expect(harness.filedArticles).toEqual([
			{
				userId,
				url: DROPPED_URL,
				readlist: WORK,
				provenance: { kind: "email", senderEmail: "news@example.com" },
				fit: { verdict: "keep", purposeVersion: PURPOSE_VERSION, source: { kind: "reader" } },
			},
		]);
		expect((await overrides()).map(({ id: _id, ...rest }) => rest)).toEqual([
			{
				url: DROPPED_URL,
				anchorText: "",
				host: "example.com",
				engineVerdict: "drop",
				engineReason: "A product launch",
				readerVerdict: "keep",
				purposeVersion: PURPOSE_VERSION,
				receivedAtMessageId: SK,
				ordinal: "0001",
				createdAt: new Date("2026-06-25T10:00:00.000Z"),
			},
		]);
	});

	it("logs the reader's choice without the link's URL", async () => {
		const { harness, userId, choose } = await setUp();

		await choose("0001", "keep");

		expect(harness.fitChoiceLines).toEqual([
			{
				level: "INFO",
				event: "readlist-fit-overridden",
				userId,
				readlist: WORK,
				receivedAtMessageId: SK,
				ordinal: "0001",
				engineVerdict: "drop",
				readerVerdict: "keep",
			},
		]);
		expect(JSON.stringify(harness.fitChoiceLines)).not.toContain("example.com/launch");
	});

	it("removes a saved link the engine kept from the readlist when the reader says it doesn't fit", async () => {
		const { fixture, harness, userId, choose, overrides } = await setUp();
		await saveInto(fixture, { userId, url: KEPT_URL });
		expect(await countWork(fixture, userId)).toBe(1);

		const response = await choose("0000", "drop");

		expect(response.headers.location).toBe(`${detailPath}?fit=drop&in=work&link=0000`);
		expect(await countWork(fixture, userId)).toBe(0);
		expect(harness.filedArticles).toEqual([]);
		expect((await overrides()).map(({ readerVerdict, anchorText }) => ({ readerVerdict, anchorText }))).toEqual([
			{ readerVerdict: "drop", anchorText: "Refactoring" },
		]);
	});

	it("remembers a drop of a link that was never saved without deleting anything", async () => {
		const { harness, choose, overrides } = await setUp();

		const response = await choose("0000", "drop");

		expect(response.status).toBe(303);
		expect(harness.filedArticles).toEqual([]);
		expect((await overrides()).map(({ readerVerdict }) => readerVerdict)).toEqual(["drop"]);
	});

	it("replaces the reader's earlier choice for the same link", async () => {
		const { choose, overrides } = await setUp();

		await choose("0001", "keep");
		await choose("0001", "drop");

		expect((await overrides()).map(({ readerVerdict }) => readerVerdict)).toEqual(["drop"]);
	});

	it.each([
		{
			name: "a tracker link whose save claimed an alias",
			linkUrl: "https://click.tracker.example/c/abc123",
			canonical: "https://blog.example.org/refactoring",
			host: "blog.example.org",
		},
		{
			name: "a direct link with an adoption alias",
			linkUrl: KEPT_URL,
			canonical: "https://www.example.net/refactoring-canonical",
			host: "example.net",
		},
	])("deletes the readlist row stored under the destination of $name and remembers its host", async ({
		linkUrl,
		canonical,
		host,
	}) => {
		const { fixture, userId, choose, overrides } = await setUp({
			links: [{ ordinal: EmailLinkOrdinalSchema.parse("0000"), url: linkUrl }],
		});
		await saveInto(fixture, { userId, url: canonical });
		await fixture.articleStore.claimAlias({ aliasUrl: linkUrl, targetOriginalUrl: canonical, now: new Date() });

		await choose("0000", "drop");

		expect(await countWork(fixture, userId)).toBe(0);
		expect((await overrides()).map(({ url, host: rowHost }) => ({ url, host: rowHost }))).toEqual([
			{ url: canonical, host },
		]);
	});

	it("removes a saved link from the readlist when the reader says it doesn't fit after choosing failed", async () => {
		const { fixture, userId, choose, overrides } = await setUp({
			outcome: { readlist: WORK, readlistLabel: "Work", decision: "failed", fit: [] },
		});
		await saveInto(fixture, { userId, url: KEPT_URL });

		await choose("0000", "drop");

		expect(await countWork(fixture, userId)).toBe(0);
		expect((await overrides()).map(({ readerVerdict }) => readerVerdict)).toEqual(["drop"]);
	});

	it("files a reader's keep with no purpose version when choosing failed", async () => {
		const { harness, choose, overrides } = await setUp({
			outcome: { readlist: WORK, readlistLabel: "Work", decision: "failed", fit: [] },
		});

		await choose("0000", "keep");

		expect(harness.filedArticles.map(({ fit }) => fit)).toEqual([
			{ verdict: "keep", purposeVersion: undefined, source: { kind: "reader" } },
		]);
		expect((await overrides()).map(({ engineVerdict }) => engineVerdict)).toEqual([undefined]);
	});

	it("undoes a drop of an engine keep by filing the engine's keep again", async () => {
		const { harness, userId, choose, overrides } = await setUp();
		await choose("0000", "drop");

		const response = await choose("0000", "undo");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(detailPath);
		expect(harness.filedArticles).toEqual([
			{
				userId,
				url: KEPT_URL,
				readlist: WORK,
				provenance: { kind: "email", senderEmail: "news@example.com" },
				fit: {
					verdict: "keep",
					reason: "Engineering practice",
					purposeVersion: PURPOSE_VERSION,
					source: { kind: "email", receivedAtMessageId: SK, ordinal: "0000" },
				},
			},
		]);
		expect(await overrides()).toEqual([]);
	});

	it("undoes a keep of an engine drop by removing the link from the readlist", async () => {
		const { fixture, userId, choose, overrides } = await setUp();
		await choose("0001", "keep");
		await saveInto(fixture, { userId, url: DROPPED_URL });

		await choose("0001", "undo");

		expect(await countWork(fixture, userId)).toBe(0);
		expect(await overrides()).toEqual([]);
	});

	it("answers an in-place choice with the card, the readlist line and an Undo toast", async () => {
		const { choose } = await setUp();

		const response = await choose("0001", "keep").set("HX-Request", "true");

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(doc.querySelector('[data-test-inbox-article-card="0001"]')).not.toBeNull();
		expect(doc.querySelector('[data-test-readlist-line="work"]')?.getAttribute("hx-swap-oob")).toBe("outerHTML");
		const toast = doc.querySelector("#status-toast");
		assert(toast, "the choice must confirm itself in the status toast");
		expect(toast.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(toast.textContent).toContain("Adding to Work…");
		const undo = toast.querySelector("form");
		assert(undo, "the toast must offer Undo");
		expect(undo.querySelector('input[name="verdict"]')?.getAttribute("value")).toBe("undo");
		expect(undo.querySelector('input[name="readlist"]')?.getAttribute("value")).toBe("work");
	});

	it("drops the card from an in-place answer once it no longer matches the filter", async () => {
		const { choose } = await setUp({
			links: [
				{ ordinal: EmailLinkOrdinalSchema.parse("0000"), url: KEPT_URL },
				{ ordinal: EmailLinkOrdinalSchema.parse("0001"), url: DROPPED_URL },
				{ ordinal: EmailLinkOrdinalSchema.parse("0002"), url: "https://example.com/tests" },
			],
			outcome: {
				...FILTERED,
				fit: [
					...FILTERED.fit,
					{ ordinal: EmailLinkOrdinalSchema.parse("0002"), verdict: "keep", reason: "Testing practice" },
				],
			},
		});

		const response = await choose("0000", "drop", "?tab=articles&readlist=work&show=fit").set("HX-Request", "true");

		const doc = parseDoc(response.text);
		expect(doc.querySelector("[data-test-inbox-article-card]")).toBeNull();
		expect(doc.querySelector("#status-toast")?.textContent).toContain("Removed from Work");
	});

	it("answers an in-place undo without a toast", async () => {
		const { choose } = await setUp();
		await choose("0001", "keep");

		const response = await choose("0001", "undo").set("HX-Request", "true");

		expect(response.status).toBe(200);
		expect(parseDoc(response.text).querySelector("#status-toast")).toBeNull();
	});

	it("keeps the page's filter on the redirect beside the confirmation", async () => {
		const { choose } = await setUp();

		const response = await choose("0001", "keep", "?tab=articles&readlist=work&show=rest");

		const location = new URL(response.headers.location, TEST_APP_ORIGIN);
		expect(location.pathname).toBe(detailPath);
		expect(Object.fromEntries(location.searchParams)).toEqual({
			tab: "articles",
			readlist: "work",
			show: "rest",
			fit: "keep",
			in: "work",
			link: "0001",
		});
	});

	it("confirms the choice on the followed redirect with an Undo that posts the reversal", async () => {
		const { agent, choose } = await setUp();
		const response = await choose("0000", "drop", "?tab=articles");

		const doc = parseDoc((await agent.get(response.headers.location)).text);

		const toast = doc.querySelector("#status-toast");
		assert(toast, "the page must carry the status toast");
		expect(toast.textContent).toContain("Removed from Work");
		const undo = toast.querySelector("form");
		assert(undo, "the toast must offer Undo");
		expect(undo.getAttribute("action")).toContain(`/links/0000/fit`);
		expect(undo.getAttribute("method")?.toUpperCase()).toBe("POST");
		expect(undo.querySelector('input[name="verdict"]')?.getAttribute("value")).toBe("undo");
	});

	it("shows no fit toast for a readlist the email was not routed to", async () => {
		const { agent } = await setUp();

		const doc = parseDoc((await agent.get(`${detailPath}?tab=articles&fit=keep&in=science&link=0001`)).text);

		expect(doc.querySelector("#status-toast")?.textContent ?? "").not.toContain("Adding to");
	});

	it("shows only the cards that fit the readlist under its filter, with their markers", async () => {
		const { agent, choose } = await setUp({
			links: [
				{ ordinal: EmailLinkOrdinalSchema.parse("0000"), url: KEPT_URL },
				{ ordinal: EmailLinkOrdinalSchema.parse("0001"), url: DROPPED_URL },
				{ ordinal: EmailLinkOrdinalSchema.parse("0002"), url: "https://example.com/tests" },
			],
		});
		await choose("0001", "keep");

		const doc = parseDoc((await agent.get(`${detailPath}?tab=articles&readlist=work&show=rest`)).text);

		expect(
			Array.from(doc.querySelectorAll("[data-test-inbox-article-card]")).map((card) =>
				card.getAttribute("data-test-inbox-article-card"),
			),
		).toEqual(["0002"]);
	});

	it("refuses a locked reader", async () => {
		const { harness, choose } = await setUp({}, new Date(Date.now() + 8 * ONE_DAY_MS));

		const response = await choose("0001", "keep");

		expect(response.status).toBe(403);
		expect(harness.filedArticles).toEqual([]);
	});

	it("refuses a read-only reader", async () => {
		const { harness, userId, choose, overrides } = await setUp();
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: "2026-06-01T00:00:00.000Z",
		});

		const response = await choose("0001", "keep");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(harness.filedArticles).toEqual([]);
		expect(await overrides()).toEqual([]);
	});

	const notFoundCases: Array<{
		name: string;
		seedWith?: Parameters<typeof seed>[1];
		ordinal?: string;
		body?: Record<string, string>;
	}> = [
		{ name: "a malformed ordinal", ordinal: "abc" },
		{ name: "an unknown link", ordinal: "0009" },
		{
			name: "an excluded link",
			seedWith: { links: [{ status: "skipped", skipReason: "list-unsubscribe", title: undefined }] },
		},
		{ name: "a link the save pipeline would reject", seedWith: { links: [{ url: "ftp://example.com/file" }] } },
		{ name: "a missing email", seedWith: { withEmail: false } },
		{ name: "a malformed choice", body: { readlist: "work", verdict: "maybe" } },
		{ name: "held saves", seedWith: { meta: { ...ROUTED_META, savesHeld: true } } },
		{ name: "a readlist the email was not routed to", body: { readlist: "science", verdict: "keep" } },
		{ name: "a readlist with no outcome yet", seedWith: { outcome: undefined } },
		{
			name: "a readlist with no purpose",
			seedWith: { outcome: { readlist: WORK, readlistLabel: "Work", decision: "no-purpose", fit: [] } },
		},
		{
			name: "a readlist that no longer exists",
			seedWith: { outcome: { readlist: WORK, readlistLabel: "Work", decision: "readlist-missing", fit: [] } },
		},
		{ name: "a link the engine did not judge", seedWith: { outcome: { ...FILTERED, fit: [] } } },
		{ name: "an undo with no choice to undo", body: { readlist: "work", verdict: "undo" } },
	];

	it.each(notFoundCases)("returns 404 for $name and changes nothing", async ({ seedWith, ordinal, body }) => {
		const { harness, agent, overrides } = await setUp(seedWith);

		const response = await agent
			.post(fitPath(ordinal ?? "0000"))
			.type("form")
			.send(body ?? { readlist: "work", verdict: "keep" });

		expect(response.status).toBe(404);
		expect(harness.filedArticles).toEqual([]);
		expect(harness.fitChoiceLines).toEqual([]);
		expect(await overrides()).toEqual([]);
	});
});
