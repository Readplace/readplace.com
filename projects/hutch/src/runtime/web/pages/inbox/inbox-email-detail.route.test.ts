import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailStatus,
	InboxAddressSchema,
	MessageIdSchema,
	parseEmail,
	sanitizeEmailHtml,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const SK = "2026-06-24T09:00:00.000Z#<view@x>";

function emailEntry(userId: UserId, status: InboxEmailStatus): InboxEmailEntry {
	const messageId = MessageIdSchema.parse("<view@x>");
	return {
		userId,
		receivedAtMessageId: SK,
		messageId,
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status,
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/view",
		bodyS3Key: status === "received" ? "content/view/content.html" : undefined,
	};
}

async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	status: InboxEmailStatus,
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailStore.putEmail(emailEntry(user.userId, status));
}

function linkEntry(userId: UserId, overrides: Partial<InboxEmailLinkEntry>): InboxEmailLinkEntry {
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

async function seedLinks(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	links: Partial<InboxEmailLinkEntry>[],
	options: { truncated?: boolean } = {},
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	for (const link of links) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLink(linkEntry(user.userId, link));
	}
	if (options.truncated === true) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId: user.userId,
			receivedAtMessageId: SK,
			meta: { truncated: true },
		});
	}
}

const detailPath = `/inbox/${encodeURIComponent(SK)}?feature=email`;

describe("Inbox email detail route", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}`);

		expect(response.status).toBe(404);
	});

	it("returns 404 for an email the user does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(detailPath);

		expect(response.status).toBe(404);
	});

	it("renders a received email in a hardened, script-free sandboxed View tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>Sanitized newsletter body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;

		// Both tabs render; View is the active one. With no links extracted yet the
		// Articles panel shows its empty state.
		const viewTab = doc.querySelector('[data-test-inbox-tab="view"]');
		const articlesTab = doc.querySelector('[data-test-inbox-tab="articles"]');
		assert(viewTab, "View tab must render");
		assert(articlesTab, "Articles tab must render");
		expect(viewTab.getAttribute("aria-current")).toBe("page");
		expect(articlesTab.getAttribute("aria-current")).toBeNull();
		expect(doc.querySelector("[data-test-articles-empty]")).not.toBeNull();

		// The iframe sandbox is EXACTLY the safe set — no allow-scripts, no
		// allow-same-origin — so the email document is inert and opaque.
		const iframe = doc.querySelector("[data-test-inbox-email-iframe]");
		assert(iframe, "View tab must render the iframe");
		expect(iframe.getAttribute("sandbox")).toBe(
			"allow-popups allow-popups-to-escape-sandbox",
		);

		// The srcdoc carries the restrictive CSP and the sanitized body, and no
		// script survives anywhere in the rendered page.
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry a srcdoc");
		expect(srcdoc).toContain("img-src 'self'");
		expect(srcdoc).toContain("Sanitized newsletter body");
		expect(response.text).not.toContain("<script>alert");

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"noindex, nofollow",
		);

		// The received instant renders as a localisable <time> baseline: it carries
		// the stored UTC ISO in datetime, the datetime enhancement mode, and an
		// unambiguous UTC-labelled text for the no-JavaScript case.
		const received = doc.querySelector(".inbox-email-detail__received");
		assert(received, "received time element must render");
		expect(received.getAttribute("datetime")).toBe("2026-06-24T09:00:00.000Z");
		expect(received.getAttribute("data-local-time")).toBe("datetime");
		expect(received.textContent).toBe("24 June 2026, 09:00 UTC");
	});

	it("renders a text-only received email's plain text in the View tab, not a blank frame", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const parsed = await parseEmail({
			raw: Buffer.from(
				[
					"From: news@example.com",
					"Subject: Text digest",
					"Message-ID: <view@x>",
					"Content-Type: text/plain; charset=utf-8",
					"",
					"Plain-text newsletter body",
				].join("\r\n"),
				"utf8",
			),
			receivedAt: "2026-06-24T09:00:00.000Z",
		});
		assert(parsed.ok);
		// Drive the real store pipeline (synthesize → sanitize) so a regression that
		// re-empties a text-only body would resurface here as a blank View tab.
		fixture.inboxEmail.readEmailContent = async () =>
			sanitizeEmailHtml({ html: parsed.email.html, rehostedImages: {} });
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const iframe = doc.querySelector("[data-test-inbox-email-iframe]");
		assert(iframe, "a text-only received email must still render the View-tab iframe");
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry a srcdoc");
		expect(srcdoc).toContain("Plain-text newsletter body");
		expect(srcdoc).toContain("<pre>");
		expect(doc.querySelector("[data-test-inbox-email-unavailable]")).toBeNull();
	});

	it("shows the graceful unavailable panel for an unparsed email instead of an empty frame", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "unparsed");

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-inbox-email-unavailable]")).not.toBeNull();
		expect(doc.querySelector("[data-test-inbox-email-iframe]")).toBeNull();
		expect(doc.querySelector("[data-test-articles-empty]")).not.toBeNull();
	});

	it("renders one preview card per extracted link, with per-state markup", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{
				ordinal: EmailLinkOrdinalSchema.parse("0000"),
				status: "crawled",
				title: "Crawled headline",
				excerpt: "An excerpt",
				siteName: "Example",
				imageUrl: "https://cdn.test/x.jpg",
			},
			{ ordinal: EmailLinkOrdinalSchema.parse("0001"), status: "pending" },
			{
				ordinal: EmailLinkOrdinalSchema.parse("0002"),
				status: "failed",
				failureReason: "crawl-failed",
			},
		]);

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const cards = doc.querySelectorAll("[data-test-inbox-article-card]");
		expect(cards).toHaveLength(3);
		expect(doc.querySelector("[data-test-articles-empty]")).toBeNull();
		// Crawled card shows the title; pending card keeps polling; failed card degrades.
		expect(doc.querySelector("[data-test-inbox-article-title]")?.textContent).toBe(
			"Crawled headline",
		);
		const pendingCard = doc.querySelector('[data-test-inbox-article-card="0001"]');
		assert(pendingCard, "pending card must render");
		expect(pendingCard.getAttribute("data-card-status")).toBe("pending");
		expect(pendingCard.getAttribute("hx-get")).toContain("/links/0001/card");
		expect(doc.querySelector("[data-test-inbox-article-failed]")).not.toBeNull();

		// The View tab and its sandboxed iframe are unchanged by the Articles panel.
		const iframe = doc.querySelector("[data-test-inbox-email-iframe]");
		assert(iframe, "the View-tab iframe must still render");
		expect(iframe.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
	});

	it("surfaces a truncated notice when the per-email link cap was hit", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "pending" }], {
			truncated: true,
		});

		const response = await agent.get(detailPath);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-articles-truncated]")).not.toBeNull();
	});
});
