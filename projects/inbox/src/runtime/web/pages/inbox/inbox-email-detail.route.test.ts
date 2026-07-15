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
	// The meta barrier is always written once extraction finishes, so write it here
	// too: seeded link rows then render as the terminal card set rather than the
	// still-extracting state.
	await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
		userId: user.userId,
		receivedAtMessageId: SK,
		meta: { truncated: options.truncated === true },
	});
}

async function seedExtractionMeta(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
		userId: user.userId,
		receivedAtMessageId: SK,
		meta: { truncated: false },
	});
}

const detailPath = `/inbox/${encodeURIComponent(SK)}?feature=email`;
const articlesTabPath = `${detailPath}&tab=articles`;

function parseDoc(html: string) {
	return new JSDOM(html).window.document;
}

function renderedPanels(doc: ReturnType<typeof parseDoc>): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-tab-panel]")).map((panel) =>
		panel.getAttribute("data-test-tab-panel"),
	);
}

describe("Inbox email detail View tab", () => {
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
		const doc = parseDoc(response.text);

		const viewTab = doc.querySelector('[data-test-inbox-tab="view"]');
		const articlesTab = doc.querySelector('[data-test-inbox-tab="articles"]');
		assert(viewTab, "View tab must render");
		assert(articlesTab, "Articles tab must render");
		expect(viewTab.getAttribute("aria-current")).toBe("page");
		expect(articlesTab.getAttribute("aria-current")).toBeNull();
		expect(articlesTab.getAttribute("href")).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles`,
		);
		expect(renderedPanels(doc)).toEqual(["view"]);

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
		expect(received.textContent).toBe("Jun 24, 2026, 09:00 UTC");
	});

	it("keeps the header link count on the View tab, where the cards are not rendered", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "crawled", title: "One" },
			{ ordinal: EmailLinkOrdinalSchema.parse("0001"), status: "pending" },
		]);

		const response = await agent.get(detailPath);

		const doc = parseDoc(response.text);
		expect(doc.querySelector("[data-test-inbox-detail-link-count]")?.textContent).toBe("2 links");
		expect(renderedPanels(doc)).toEqual(["view"]);
		expect(doc.querySelectorAll("[data-test-inbox-article-card]")).toHaveLength(0);
	});

	it("falls back to the View tab for a tab that does not exist", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(`${detailPath}&tab=nope`);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(renderedPanels(doc)).toEqual(["view"]);
		expect(doc.querySelector('[data-test-inbox-tab="view"]')?.getAttribute("aria-current")).toBe(
			"page",
		);
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
		const doc = parseDoc(response.text);
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
		const doc = parseDoc(response.text);
		expect(doc.querySelector("[data-test-inbox-email-unavailable]")).not.toBeNull();
		expect(doc.querySelector("[data-test-inbox-email-iframe]")).toBeNull();
		expect(renderedPanels(doc)).toEqual(["view"]);
	});
});

describe("Inbox email detail Articles tab", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}?tab=articles`);

		expect(response.status).toBe(404);
	});

	it("renders one preview card per extracted link, with per-state markup and no email body", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let bodyReads = 0;
		fixture.inboxEmail.readEmailContent = async () => {
			bodyReads += 1;
			return "<p>body</p>";
		};
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

		const response = await agent.get(articlesTabPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(renderedPanels(doc)).toEqual(["articles"]);
		expect(doc.querySelectorAll("[data-test-inbox-article-card]")).toHaveLength(3);
		expect(doc.querySelector("[data-test-inbox-detail-link-count]")?.textContent).toBe("3 links");
		expect(doc.querySelector("[data-test-inbox-article-title]")?.textContent).toBe(
			"Crawled headline",
		);
		const pendingCard = doc.querySelector('[data-test-inbox-article-card="0001"]');
		assert(pendingCard, "pending card must render");
		expect(pendingCard.getAttribute("data-card-status")).toBe("pending");
		expect(pendingCard.getAttribute("hx-get")).toContain("/links/0001/card");
		expect(doc.querySelector("[data-test-inbox-article-failed]")).not.toBeNull();

		expect(bodyReads).toBe(0);
		expect(doc.querySelector("[data-test-inbox-email-iframe]")).toBeNull();

		const articlesTab = doc.querySelector('[data-test-inbox-tab="articles"]');
		const viewTab = doc.querySelector('[data-test-inbox-tab="view"]');
		assert(articlesTab, "Articles tab must render");
		assert(viewTab, "View tab must render");
		expect(articlesTab.getAttribute("aria-current")).toBe("page");
		expect(viewTab.getAttribute("aria-current")).toBeNull();
		expect(viewTab.getAttribute("href")).toBe(`/inbox/${encodeURIComponent(SK)}?feature=email`);
	});

	it("surfaces a truncated notice when the per-email link cap was hit", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "pending" }], {
			truncated: true,
		});

		const response = await agent.get(articlesTabPath);

		const doc = parseDoc(response.text);
		expect(doc.querySelector("[data-test-articles-truncated]")).not.toBeNull();
	});

	it("polls the Articles panel while extraction has not yet written its meta barrier", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(articlesTabPath);

		const doc = parseDoc(response.text);
		const panel = doc.querySelector('[data-test-tab-panel="articles"]');
		assert(panel, "the Articles panel must render");
		expect(panel.getAttribute("data-articles-status")).toBe("extracting");
		expect(panel.getAttribute("hx-get")).toContain("/articles");
		expect(doc.querySelector("[data-test-articles-extracting]")).not.toBeNull();
		// The header badge is an always-present OOB swap anchor, but withholds the
		// count until extraction finishes, so it renders empty rather than absent.
		const linkCount = doc.querySelector("[data-test-inbox-detail-link-count]");
		assert(linkCount, "the header link-count anchor must render as an OOB swap target");
		expect(linkCount.textContent).toBe("");
	});

	it("shows the terminal no-links state once extraction wrote its meta with zero links", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedExtractionMeta(fixture);

		const response = await agent.get(articlesTabPath);

		const doc = parseDoc(response.text);
		const panel = doc.querySelector('[data-test-tab-panel="articles"]');
		assert(panel, "the Articles panel must render");
		expect(panel.getAttribute("data-articles-status")).toBe("terminal");
		expect(panel.getAttribute("hx-get")).toBeNull();
		expect(doc.querySelector("[data-test-articles-empty]")).not.toBeNull();
		expect(doc.querySelector("[data-test-articles-extracting]")).toBeNull();
	});

	it("is terminally empty for an unparsed email, which never runs extraction", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "unparsed");

		const response = await agent.get(articlesTabPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(renderedPanels(doc)).toEqual(["articles"]);
		const panel = doc.querySelector('[data-test-tab-panel="articles"]');
		assert(panel, "the Articles panel must render");
		expect(panel.getAttribute("data-articles-status")).toBe("terminal");
		expect(doc.querySelector("[data-test-articles-empty]")).not.toBeNull();
	});
});

const articlesPath = `/inbox/${encodeURIComponent(SK)}/articles?feature=email`;

describe("Inbox Articles panel poll route", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}/articles`);

		expect(response.status).toBe(404);
	});

	it("returns 404 for an email the user does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(articlesPath);

		expect(response.status).toBe(404);
	});

	it("keeps polling, with an incremented count, while extraction is pending", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(`${articlesPath}&poll=1`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = doc.querySelector('[data-test-tab-panel="articles"]');
		assert(panel, "the panel fragment must render");
		expect(panel.getAttribute("data-articles-status")).toBe("extracting");
		expect(panel.getAttribute("hx-get")).toContain("poll=2");
		// The OOB header badge ships with every tick but stays empty while extracting,
		// so the header keeps withholding the count in lockstep with the panel.
		const linkCount = doc.querySelector("[data-test-inbox-detail-link-count]");
		assert(linkCount, "the poll fragment must carry the OOB link-count anchor");
		expect(linkCount.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(linkCount.textContent).toBe("");
	});

	it("gives up to a terminal stale notice once the poll budget is spent without a meta barrier", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(`${articlesPath}&poll=301`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = doc.querySelector('[data-test-tab-panel="articles"]');
		assert(panel, "the panel fragment must render");
		expect(panel.getAttribute("data-articles-status")).toBe("stale");
		expect(panel.getAttribute("hx-get")).toBeNull();
		expect(doc.querySelector("[data-test-articles-stale]")).not.toBeNull();
		expect(doc.querySelector("[data-test-articles-extracting]")).toBeNull();
	});

	it("swaps in the finished card set once extraction wrote its meta", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
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
		]);

		const response = await agent.get(articlesPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = doc.querySelector('[data-test-tab-panel="articles"]');
		assert(panel, "the panel fragment must render");
		expect(panel.getAttribute("data-articles-status")).toBe("terminal");
		expect(panel.getAttribute("hx-get")).toBeNull();
		expect(doc.querySelectorAll("[data-test-inbox-article-card]")).toHaveLength(1);
		expect(doc.querySelector("[data-test-inbox-article-title]")?.textContent).toBe(
			"Crawled headline",
		);
		// The terminal tick carries the count as an OOB swap so the header badge catches
		// up to the swapped-in card set without waiting for a full page reload.
		const linkCount = doc.querySelector("[data-test-inbox-detail-link-count]");
		assert(linkCount, "the terminal poll fragment must carry the OOB link-count update");
		expect(linkCount.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(linkCount.textContent).toBe("1 link");
	});
});
