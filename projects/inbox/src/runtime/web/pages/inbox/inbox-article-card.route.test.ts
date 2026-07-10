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
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
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

describe("Inbox link-preview card route", () => {
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
		expect(card.querySelector("[data-test-inbox-article-pending]")).not.toBeNull();
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

	it("stops polling and shows the give-up state once the poll budget is spent", async () => {
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
		expect(card.querySelector("[data-test-inbox-article-stale-pending]")).not.toBeNull();
		expect(card.querySelector("[data-test-inbox-article-pending]")).toBeNull();
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
		expect(card.querySelector("[data-test-inbox-article-title]")?.textContent).toBe("Crawled title");
	});

	it("returns a failed card fragment with the graceful couldn't-preview copy", async () => {
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
		expect(card.getAttribute("hx-get")).toBeNull();
		expect(card.querySelector("[data-test-inbox-article-failed]")).not.toBeNull();
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
