import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<card@x>";

function link(userId: UserId, overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		...overrides,
	};
}

async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	overrides: Partial<InboxEmailLinkEntry> = {},
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(link(user.userId, overrides));
}

const cardPath = `/inbox/${encodeURIComponent(SK)}/links/0000/card?feature=email`;

function cardActions(card: Element): string[] {
	return Array.from(card.querySelectorAll("[data-test-card-action]")).map(
		(el) => el.getAttribute("data-test-card-action") ?? "",
	);
}

function expectBareUrlRow(card: Element): void {
	const bare = card.querySelector("[data-test-inbox-article-url]");
	assert(bare, "the bare URL anchor must render");
	expect(bare.getAttribute("href")).toBe("https://example.com/post");
	expect(bare.textContent).toBe("https://example.com/post");
	expect(cardActions(card)).toEqual(["save", "feedback-exclude"]);
	const save = card.querySelector('[data-test-card-action="save"]');
	assert(save, "the save button must render for a saveable link");
	const form = save.closest("form");
	expect(form?.getAttribute("action")).toBe(
		`/inbox/${encodeURIComponent(SK)}/links/0000/save?feature=email`,
	);
	// Boosted so the confirmation swaps in place. A full navigation would reset
	// the scroll position, putting the toast where the reader is not looking.
	expect(form?.getAttribute("hx-boost")).toBe("true");
	expect(form?.getAttribute("hx-select")).toBe("main");
	expect(form?.getAttribute("hx-disabled-elt")).toBe("find button");
}

describe("Inbox link card route", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}/links/0000/card`);

		expect(response.status).toBe(404);
	});

	it("returns 404 for an unknown link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(cardPath);

		expect(response.status).toBe(404);
	});

	it("returns 404 for a skipped link, which renders only as an excluded row", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "list-unsubscribe" });

		const response = await agent.get(cardPath);

		expect(response.status).toBe(404);
	});

	it("returns 404 for a malformed ordinal without touching the store", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.get(
			`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/card?feature=email`,
		);

		expect(response.status).toBe(404);
	});

	it("returns a pending card fragment that keeps polling", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "pending" });

		const response = await agent.get(cardPath);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		expect(card.getAttribute("data-card-status")).toBe("pending");
		expect(card.getAttribute("hx-get")).toContain("/links/0000/card");
		expectBareUrlRow(card);
	});

	it("treats a non-numeric poll cursor as the start of the budget instead of polling unbounded", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "pending" });

		const response = await agent.get(`${cardPath}&poll=not-a-number`);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		expect(card.getAttribute("data-card-status")).toBe("pending");
		expect(card.getAttribute("hx-get")).toContain("poll=1");
	});

	it("stops polling and renders the bare URL once the poll budget is spent", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "pending" });

		const response = await agent.get(`${cardPath}&poll=300`);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		expect(card.getAttribute("data-card-status")).toBe("terminal");
		expect(card.getAttribute("hx-get")).toBeNull();
		expectBareUrlRow(card);
	});

	it("returns a crawled card fragment with no further polling", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, {
			status: "crawled",
			title: "Crawled title",
			excerpt: "An excerpt",
			siteName: "Example",
			imageUrl: "https://cdn.test/x.jpg",
		});

		const response = await agent.get(cardPath);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		expect(card.getAttribute("data-card-status")).toBe("terminal");
		expect(card.getAttribute("hx-get")).toBeNull();
		expect(cardActions(card)).toEqual(["save", "feedback-exclude"]);
		const title = card.querySelector("[data-test-inbox-article-title]");
		assert(title, "the crawled row must render its title as a link");
		expect(title.tagName).toBe("A");
		expect(title.textContent).toBe("Crawled title");
		expect(title.getAttribute("href")).toBe("https://example.com/post");
		expect(title.getAttribute("target")).toBe("_blank");
		const url = card.querySelector("[data-test-inbox-article-url]");
		assert(url, "the crawled row must show its URL beneath the title");
		expect(url.tagName).toBe("SPAN");
		expect(url.textContent).toBe("https://example.com/post");
	});

	it("renders the post-redirect destination, not the newsletter tracking link, once the crawl resolved it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, {
			status: "crawled",
			title: "Crawled title",
			url: "https://nodeweekly.com/link/187980/4be0b3f821",
			resolvedUrl: "https://destination.test/the-actual-article",
		});

		const response = await agent.get(cardPath);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		const title = card.querySelector("[data-test-inbox-article-title]");
		assert(title, "the crawled row must render its title as a link");
		expect(title.getAttribute("href")).toBe("https://destination.test/the-actual-article");
		const url = card.querySelector("[data-test-inbox-article-url]");
		assert(url, "the crawled row must show its URL beneath the title");
		expect(url.textContent).toBe("https://destination.test/the-actual-article");
	});

	it("returns a failed card fragment as its bare URL with no status copy", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "failed", failureReason: "crawl-failed" });

		const response = await agent.get(cardPath);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		expect(card.getAttribute("data-card-status")).toBe("terminal");
		expect(card.getAttribute("hx-get")).toBeNull();
		expectBareUrlRow(card);
	});

	it("renders no Save button for a link the save pipeline would reject", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "failed", url: "https://localhost/private" });

		const response = await agent.get(cardPath);

		expect(response.status).toBe(200);
		const card = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-article-card]",
		);
		assert(card, "the card fragment must render");
		expect(cardActions(card)).toEqual(["feedback-exclude"]);
		const bare = card.querySelector("[data-test-inbox-article-url]");
		assert(bare, "the bare URL anchor must render");
		expect(bare.getAttribute("href")).toBe("https://localhost/private");
	});

	it("revalidates with a 304 when the link has not changed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "pending" });

		const first = await agent.get(cardPath);
		const etag = first.headers.etag;
		assert(etag, "the card response must carry an ETag");

		const second = await agent.get(cardPath).set("If-None-Match", etag);

		expect(second.status).toBe(304);
	});
});
