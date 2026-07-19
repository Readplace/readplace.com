import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
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
		linkCounts: undefined,
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

	it("shows the Inbox nav entry on the flagged list page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const inbox = await agent.get("/inbox?feature=email");

		expect(navItemKeys(inbox.text)).toContain("inbox");
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
		await fixture.inboxEmail.inboxEmailStore.setEmailLinkCounts({
			userId: user.userId,
			receivedAtMessageId: withLinks,
			linkCounts: { kept: 2, skipped: 1, truncated: false },
		});

		const response = await agent.get("/inbox?feature=email");

		const rows = Array.from(
			new JSDOM(response.text).window.document.querySelectorAll("[data-test-inbox-emails-row]"),
		);
		expect(rows[0].querySelector("[data-test-inbox-email-link-count]")?.textContent).toBe("2 links");
		expect(rows[1].querySelector("[data-test-inbox-email-link-count]")).toBeNull();
	});

	describe("Pagination", () => {
		function ascendingEmails(userId: UserId, count: number): InboxEmailEntry[] {
			return Array.from({ length: count }, (_, i) =>
				emailEntry(userId, {
					messageId: `<m-${i}@x>`,
					receivedAt: new Date(Date.UTC(2026, 5, 24, 0, i)).toISOString(),
					senderEmail: `sender-${i}@example.com`,
				}),
			);
		}

		it("renders the newest page with a boosted nav and only an older link", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await seedEmails(fixture, (userId) => ascendingEmails(userId, 11));

			const response = await agent.get("/inbox?feature=email");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelectorAll("[data-test-inbox-emails-row]")).toHaveLength(10);
			const pagination = doc.querySelector("[data-test-pagination]");
			assert(pagination, "pagination nav must render");
			expect(pagination.getAttribute("hx-boost")).toBe("true");
			expect(pagination.getAttribute("hx-target")).toBe("main");
			expect(pagination.getAttribute("hx-select")).toBe("main");
			expect(pagination.getAttribute("hx-swap")).toBe("outerHTML show:none");
			const links = Array.from(pagination.querySelectorAll("[data-test-pagination-link]"));
			expect(links.map((link) => link.getAttribute("data-test-pagination-link"))).toEqual([
				"older",
			]);
			expect(links[0].textContent).toBe("Older →");
			expect(links[0].getAttribute("href")).toBe(
				`/inbox?feature=email&older=${encodeURIComponent("2026-06-24T00:01:00.000Z#<m-1@x>")}`,
			);
		});

		it("shows the oldest email alone beyond the older link, linking back newer", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await seedEmails(fixture, (userId) => ascendingEmails(userId, 11));
			const first = await agent.get("/inbox?feature=email");
			const olderHref = new JSDOM(first.text).window.document
				.querySelector('[data-test-pagination-link="older"]')
				?.getAttribute("href");
			assert(olderHref, "older link must render on the newest page");

			const response = await agent.get(olderHref);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const rows = Array.from(doc.querySelectorAll("[data-test-inbox-emails-row]"));
			expect(rows).toHaveLength(1);
			expect(rows[0].querySelector("[data-test-inbox-email-sender]")?.textContent).toBe(
				"sender-0@example.com",
			);
			const pagination = doc.querySelector("[data-test-pagination]");
			assert(pagination, "pagination nav must render");
			const links = Array.from(pagination.querySelectorAll("[data-test-pagination-link]"));
			expect(links.map((link) => link.getAttribute("data-test-pagination-link"))).toEqual([
				"newer",
			]);
			expect(links[0].textContent).toBe("← Newer");

			const newerHref = links[0].getAttribute("href");
			assert(newerHref, "newer link must carry an href");
			const back = await agent.get(newerHref);
			expect(back.status).toBe(200);
			const backRows = Array.from(
				new JSDOM(back.text).window.document.querySelectorAll("[data-test-inbox-emails-row]"),
			);
			expect(backRows).toHaveLength(10);
			expect(
				backRows[0].querySelector("[data-test-inbox-email-sender]")?.textContent,
			).toBe("sender-10@example.com");
		});

		it("redirects a cursor past the oldest email back to the newest page", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await seedEmails(fixture, (userId) => ascendingEmails(userId, 11));

			const response = await agent.get(
				`/inbox?feature=email&older=${encodeURIComponent("2026-06-24T00:00:00.000Z#<m-0@x>")}`,
			);

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe("/inbox?feature=email");
			const followed = await agent.get(response.headers.location);
			expect(followed.status).toBe(200);
		});

		it("renders a full single page without a pagination nav", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await seedEmails(fixture, (userId) => ascendingEmails(userId, 10));

			const response = await agent.get("/inbox?feature=email");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelectorAll("[data-test-inbox-emails-row]")).toHaveLength(10);
			expect(doc.querySelector("[data-test-pagination]")).toBeNull();
		});

		it("redirects a cursor on an empty inbox back to the empty state", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/inbox?feature=email&older=anything");

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe("/inbox?feature=email");
			const followed = await agent.get(response.headers.location);
			expect(followed.status).toBe(200);
			const doc = new JSDOM(followed.text).window.document;
			const empty = doc.querySelector("[data-test-inbox-emails-empty]");
			assert(empty, "empty state must render after the clamp");
			expect(empty.textContent).toContain("No forwarded emails yet");
		});

		it("renders the newest page for a legacy ?page= URL", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await seedEmails(fixture, (userId) => ascendingEmails(userId, 11));

			const response = await agent.get("/inbox?feature=email&page=2");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelectorAll("[data-test-inbox-emails-row]")).toHaveLength(10);
		});
	});
});
