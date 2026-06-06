import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { NewsletterMessageIdSchema } from "@packages/domain/newsletter";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;
type Fixture = ReturnType<typeof createDefaultTestAppFixture>;

async function loginAndUserId(harness: Harness, fixture: Fixture) {
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "user must exist after login");
	return { agent, userId: user.userId };
}

describe("Newsletter routes", () => {
	describe("GET /newsletter (unauthenticated)", () => {
		it("redirects to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/newsletter");
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("GET /newsletter (authenticated, no inbox)", () => {
		it("renders a create-inbox form when no inbox exists", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent } = await loginAndUserId(harness, fixture);

			const response = await agent.get("/newsletter");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			assert(doc.querySelector("[data-test-create-inbox]"), "create-inbox form must render");
			assert.equal(doc.querySelector("[data-test-inbox-address]"), null, "inbox address must not render without inbox");
		});
	});

	describe("POST /newsletter (create inbox)", () => {
		it("creates the inbox and redirects to GET /newsletter", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent, userId } = await loginAndUserId(harness, fixture);

			const response = await agent.post("/newsletter");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/newsletter");
			const inbox = await fixture.newsletter.inboxStore.findInbox(userId);
			assert(inbox, "inbox must exist after POST");
		});
	});

	describe("GET /newsletter (authenticated, with inbox)", () => {
		it("renders the per-user inbox address and an empty state with no messages", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent, userId } = await loginAndUserId(harness, fixture);
			await fixture.newsletter.inboxStore.getOrCreateInbox(userId);

			const response = await agent.get("/newsletter");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const address = doc.querySelector("[data-test-inbox-address]");
			assert(address, "inbox address must render");
			expect(address.textContent).toContain(`@${fixture.newsletter.inboxDomain}`);
			assert(doc.querySelector("[data-test-empty]"), "empty state must render");
		});

		it("lists received messages newest-first", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent, userId } = await loginAndUserId(harness, fixture);
			await fixture.newsletter.inboxStore.getOrCreateInbox(userId);

			await fixture.newsletter.messageStore.recordMessage({
				id: NewsletterMessageIdSchema.parse("older"),
				userId,
				subject: "Older digest",
				fromAddress: "a@x.com",
				receivedAt: "2026-06-01T00:00:00.000Z",
				html: "<p>old</p>",
				savedLinks: [],
				skippedCount: 0,
			});
			await fixture.newsletter.messageStore.recordMessage({
				id: NewsletterMessageIdSchema.parse("newer"),
				userId,
				subject: "Newer digest",
				fromAddress: "a@x.com",
				receivedAt: "2026-06-05T00:00:00.000Z",
				html: "<p>new</p>",
				savedLinks: [
					{ url: "https://example.com/a", articleId: ReaderArticleHashIdSchema.parse("a".repeat(32)) },
				],
				skippedCount: 0,
			});

			const response = await agent.get("/newsletter");

			const doc = new JSDOM(response.text).window.document;
			const items = Array.from(doc.querySelectorAll("[data-test-message-item]")).map((el) =>
				el.getAttribute("data-test-message-item"),
			);
			expect(items).toEqual(["newer", "older"]);
		});
	});

	describe("GET /newsletter/:id", () => {
		it("redirects to /newsletter for a malformed id", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent } = await loginAndUserId(harness, fixture);

			const response = await agent.get(`/newsletter/${encodeURIComponent("has space")}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/newsletter");
		});

		it("redirects to /newsletter when the message does not exist", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent } = await loginAndUserId(harness, fixture);

			const response = await agent.get("/newsletter/unknownmessage");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/newsletter");
		});

		it("renders the original email, saved links, received date, and skipped note", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { agent, userId } = await loginAndUserId(harness, fixture);
			const articleId = "b".repeat(32);

			await fixture.newsletter.messageStore.recordMessage({
				id: NewsletterMessageIdSchema.parse("msg-detail"),
				userId,
				subject: "Deep dive",
				fromAddress: "news@example.com",
				receivedAt: "2026-06-05T09:07:00.000Z",
				html: "<p>Hello reader</p>",
				savedLinks: [
					{ url: "https://example.com/post", articleId: ReaderArticleHashIdSchema.parse(articleId) },
				],
				skippedCount: 2,
			});

			const response = await agent.get("/newsletter/msg-detail");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-detail-subject]")?.textContent).toBe("Deep dive");
			const link = doc.querySelector("[data-test-saved-link]");
			assert(link, "saved link must render");
			expect(link.getAttribute("href")).toBe(`/queue/${articleId}/view`);
			const frame = doc.querySelector("[data-test-email-frame]");
			assert(frame, "email iframe must render");
			expect(frame.getAttribute("srcdoc")).toContain("Hello reader");
			assert(doc.querySelector("[data-test-skipped]"), "skipped note must render");
			expect(response.text).toContain("5 Jun 2026, 09:07 UTC");
		});
	});
});
