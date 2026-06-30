import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	EmailLinkOrdinalSchema,
	InboxAddressSchema,
	type InboxEmailEntry,
	MessageIdSchema,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

function navItemKeys(html: string): (string | null)[] {
	const doc = new JSDOM(html).window.document;
	return Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) =>
		el.getAttribute("data-test-nav-item"),
	);
}

type EmailEntryInput = { messageId: string; receivedAt: string } & Partial<
	Omit<InboxEmailEntry, "userId" | "messageId" | "receivedAt" | "receivedAtMessageId">
>;

function emailEntry(userId: UserId, input: EmailEntryInput): InboxEmailEntry {
	const messageId = MessageIdSchema.parse(input.messageId);
	const { messageId: _rawMessageId, receivedAt, ...rest } = input;
	return {
		userId,
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "A subject",
		status: "received",
		rawEmailS3Key: `inbound/${messageId}`,
		bodyS3Key: `content/${messageId}/content.html`,
		...rest,
		messageId,
		receivedAt,
		receivedAtMessageId: `${receivedAt}#${messageId}`,
	};
}

async function seedEmails(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	entries: (userId: UserId) => InboxEmailEntry[],
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding emails");
	for (const entry of entries(user.userId)) {
		await fixture.inboxEmail.inboxEmailStore.putEmail(entry);
	}
}

describe("Inbox emails list route", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox");

		expect(response.status).toBe(404);
	});

	it("redirects an unauthenticated visitor to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/inbox?feature=email");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("renders the empty state, noindexed, when the user has no emails", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox?feature=email");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-inbox-emails-empty]")).not.toBeNull();
		expect(doc.querySelector("[data-test-inbox-emails-list]")).toBeNull();
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"noindex, nofollow",
		);
	});

	it("shows the Inbox nav entry and lands on the list when the flag is present", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const withFlag = await agent.get("/queue?feature=email");
		expect(navItemKeys(withFlag.text)).toContain("inbox");

		const withoutFlag = await agent.get("/queue");
		expect(navItemKeys(withoutFlag.text)).not.toContain("inbox");

		const inbox = await agent.get("/inbox?feature=email");
		expect(
			new JSDOM(inbox.text).window.document.querySelector("[data-test-inbox-emails]"),
		).not.toBeNull();
	});

	it("renders received, unparsed, and rejected emails newest-first with badges and links", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		// Pin the clock so the relative-mode assertion stays deterministic: under the
		// default real-time clock these fixed receivedAt instants would eventually
		// cross the relative cutoff and render as `date` instead of `relative`.
		fixture.shared.now = () => new Date("2026-06-24T12:00:00.000Z");
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedEmails(fixture, (userId) => [
			emailEntry(userId, {
				messageId: "<r1@x>",
				receivedAt: "2026-06-24T07:00:00.000Z",
				senderEmail: "a@example.com",
				subject: "",
				status: "rejected",
				bodyS3Key: undefined,
			}),
			emailEntry(userId, {
				messageId: "<r2@x>",
				receivedAt: "2026-06-24T08:00:00.000Z",
				senderEmail: "b@example.com",
				subject: "Could not render me",
				status: "unparsed",
				bodyS3Key: undefined,
			}),
			emailEntry(userId, {
				messageId: "<r3@x>",
				receivedAt: "2026-06-24T09:00:00.000Z",
				senderEmail: "c@example.com",
				subject: "Newest digest",
				status: "received",
			}),
		]);

		const response = await agent.get("/inbox?feature=email");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const rows = Array.from(doc.querySelectorAll("[data-test-inbox-emails-row]"));
		expect(rows).toHaveLength(3);

		const senders = rows.map(
			(row) => row.querySelector("[data-test-inbox-email-sender]")?.textContent,
		);
		expect(senders).toEqual(["c@example.com", "b@example.com", "a@example.com"]);

		const newestHref = rows[0].querySelector("a")?.getAttribute("href");
		expect(newestHref).toBe(
			`/inbox/${encodeURIComponent("2026-06-24T09:00:00.000Z#<r3@x>")}?feature=email`,
		);

		expect(rows[2].querySelector("[data-test-inbox-email-subject]")?.textContent).toBe(
			"(no subject)",
		);

		// The received time renders as a localisable <time> baseline carrying the
		// stored UTC ISO in datetime and an enhancement mode for the client script.
		const time = rows[0].querySelector("[data-test-inbox-email-time]");
		assert(time, "received time element must render");
		expect(time.tagName).toBe("TIME");
		expect(time.getAttribute("datetime")).toBe("2026-06-24T09:00:00.000Z");
		expect(time.getAttribute("data-local-time")).toBe("relative");

		expect(rows[0].querySelector("[data-test-inbox-email-status]")).toBeNull();
		expect(
			rows[1].querySelector('[data-test-inbox-email-status="unparsed"]'),
		).not.toBeNull();
		expect(
			rows[2].querySelector('[data-test-inbox-email-status="rejected"]'),
		).not.toBeNull();
	});

	it("shows an 'N links' badge only on rows whose links have been extracted", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const withLinks = "2026-06-24T09:00:00.000Z#<with@x>";
		await seedEmails(fixture, (userId) => [
			emailEntry(userId, { messageId: "<with@x>", receivedAt: "2026-06-24T09:00:00.000Z" }),
			emailEntry(userId, { messageId: "<none@x>", receivedAt: "2026-06-24T08:00:00.000Z" }),
		]);
		const user = await fixture.auth.findUserByEmail("test@example.com");
		assert(user, "user must exist");
		for (const ordinal of ["0000", "0001"]) {
			await fixture.inboxEmail.inboxEmailLinkStore.putLink({
				userId: user.userId,
				receivedAtMessageId: withLinks,
				ordinal: EmailLinkOrdinalSchema.parse(ordinal),
				url: `https://example.com/${ordinal}`,
				status: "pending",
				title: undefined,
				excerpt: undefined,
				siteName: undefined,
				imageUrl: undefined,
				failureReason: undefined,
			});
		}

		const response = await agent.get("/inbox?feature=email");

		const rows = Array.from(
			new JSDOM(response.text).window.document.querySelectorAll("[data-test-inbox-emails-row]"),
		);
		expect(rows[0].querySelector("[data-test-inbox-email-link-count]")?.textContent).toBe("2 links");
		expect(rows[1].querySelector("[data-test-inbox-email-link-count]")).toBeNull();
	});
});
