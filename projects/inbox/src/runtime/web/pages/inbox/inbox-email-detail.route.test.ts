import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailStatus,
	InboxAddressSchema,
	MessageIdSchema,
	formatEmailLinkOrdinal,
	parseEmail,
	sanitizeEmailHtml,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { TEST_IMAGES_CDN_BASE_URL, loginAgent, useTestServer } from "../../../test-app";

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

function manyCrawledLinks(count: number): Partial<InboxEmailLinkEntry>[] {
	return Array.from({ length: count }, (_unused, index) => ({
		ordinal: formatEmailLinkOrdinal(index),
		url: `https://example.com/post-${index}`,
		status: "crawled" as const,
		title: `Post ${index}`,
	}));
}

const detailPath = `/inbox/${encodeURIComponent(SK)}?feature=email`;
const articlesTabPath = `${detailPath}&tab=articles`;
const excludedTabPath = `${detailPath}&tab=excluded`;

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
		const excludedTab = doc.querySelector('[data-test-inbox-tab="excluded"]');
		assert(viewTab, "View tab must render");
		assert(articlesTab, "Articles tab must render");
		assert(excludedTab, "Skipped tab must render");
		expect(viewTab.getAttribute("aria-current")).toBe("page");
		expect(articlesTab.getAttribute("aria-current")).toBeNull();
		expect(excludedTab.getAttribute("aria-current")).toBeNull();
		expect(articlesTab.getAttribute("href")).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles`,
		);
		expect(excludedTab.getAttribute("href")).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=excluded`,
		);
		expect(renderedPanels(doc)).toEqual(["view"]);

		// The iframe sandbox is EXACTLY the safe set — no allow-scripts, no
		// allow-same-origin — so the email document is inert and opaque.
		const iframe = doc.querySelector("[data-test-inbox-email-iframe]");
		assert(iframe, "View tab must render the iframe");
		expect(iframe.getAttribute("sandbox")).toBe(
			"allow-popups allow-popups-to-escape-sandbox",
		);

		// The srcdoc carries the restrictive CSP — images only from data: URIs and
		// our CDN origin, never a sender host — and the sanitized body, and no
		// script survives anywhere in the rendered page.
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry a srcdoc");
		expect(srcdoc).toContain(`img-src data: ${TEST_IMAGES_CDN_BASE_URL};`);
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

	it("keeps a rehosted CDN image src in the srcdoc so newsletter images render", async () => {
		const cdnSrc = `${TEST_IMAGES_CDN_BASE_URL}/content/email-images/abc123/0011223344556677.png`;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () =>
			`<p>Photo issue</p><img src="${cdnSrc}" alt="hero" width="640">`;
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		const iframe = doc.querySelector("[data-test-inbox-email-iframe]");
		assert(iframe, "View tab must render the iframe");
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry a srcdoc");
		expect(srcdoc).toContain(`src="${cdnSrc}"`);
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

	it("renders one link row per extracted link, with per-state markup and no email body", async () => {
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
		// Each tab carries how many items it holds, so a reader can see what's on the
		// other tab without opening it.
		expect(doc.querySelector('[data-test-inbox-tab="articles"]')?.textContent).toBe(
			"Extracted Articles (3)",
		);
		expect(doc.querySelector('[data-test-inbox-tab="excluded"]')?.textContent).toBe(
			"Skipped (0)",
		);
		expect(doc.querySelector('[data-test-inbox-tab="view"]')?.textContent).toBe("View");
		expect(doc.querySelector("[data-test-inbox-article-title]")?.textContent).toBe(
			"Crawled headline",
		);
		const pendingCard = doc.querySelector('[data-test-inbox-article-card="0001"]');
		assert(pendingCard, "pending card must render");
		expect(pendingCard.getAttribute("data-card-status")).toBe("pending");
		expect(pendingCard.getAttribute("hx-get")).toContain("/links/0001/card");
		const failedCard = doc.querySelector('[data-test-inbox-article-card="0002"]');
		assert(failedCard, "failed card must render");
		expect(failedCard.getAttribute("data-card-status")).toBe("terminal");
		const failedUrl = failedCard.querySelector("[data-test-inbox-article-url]");
		assert(failedUrl, "failed card renders its bare URL");
		expect(failedUrl.tagName).toBe("A");
		expect(failedUrl.getAttribute("href")).toBe("https://example.com/post");

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

	it("keeps only the kept links on the Articles tab, with an exclude-feedback form", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "crawled", title: "Kept article" },
			{
				ordinal: EmailLinkOrdinalSchema.parse("0001"),
				url: "https://news.example.com/unsub",
				status: "skipped",
				skipReason: "list-unsubscribe",
			},
		]);

		const response = await agent.get(articlesTabPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		const cardOrdinals = Array.from(
			doc.querySelectorAll("[data-test-inbox-article-card]"),
		).map((el) => el.getAttribute("data-test-inbox-article-card"));
		expect(cardOrdinals).toEqual(["0000"]);
		expect(doc.querySelector("[data-test-inbox-detail-link-count]")?.textContent).toBe("1 link");
		// The tabs split the same way the panels do: the skipped link is counted by
		// the Skipped tab, never by Extracted Articles.
		expect(doc.querySelector('[data-test-inbox-tab="articles"]')?.textContent).toBe(
			"Extracted Articles (1)",
		);
		expect(doc.querySelector('[data-test-inbox-tab="excluded"]')?.textContent).toBe(
			"Skipped (1)",
		);

		// A skipped link belongs to the Skipped tab alone; rendering it here too
		// would show the same row on two tabs.
		expect(doc.querySelector("[data-test-inbox-excluded]")).toBeNull();
		expect(doc.querySelector('[data-test-inbox-excluded-link="0001"]')).toBeNull();

		const keptCard = doc.querySelector('[data-test-inbox-article-card="0000"]');
		assert(keptCard, "kept card must render");
		const excludeButton = keptCard.querySelector("[data-test-inbox-feedback-exclude]");
		assert(excludeButton, "kept card must offer exclude feedback");
		expect(
			excludeButton.closest("form")?.querySelector('input[name="verdict"]')?.getAttribute("value"),
		).toBe("should-be-excluded");
	});

	it("still discloses the extraction cap when every link was skipped", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(
			fixture,
			[
				{
					ordinal: EmailLinkOrdinalSchema.parse("0000"),
					url: "https://news.example.com/unsub",
					status: "skipped",
					skipReason: "list-unsubscribe",
				},
			],
			{ truncated: true },
		);

		const articles = await agent.get(articlesTabPath);
		const excluded = await agent.get(excludedTabPath);

		// The cap is an email-level fact. This email renders an EMPTY Articles panel, so
		// a notice confined to the non-empty branch would vanish from every tab.
		expect(parseDoc(articles.text).querySelector("[data-test-articles-truncated]")).not.toBeNull();
		expect(parseDoc(excluded.text).querySelector("[data-test-excluded-truncated]")).not.toBeNull();
	});

	it("says where the links went when every one of them was skipped", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{
				ordinal: EmailLinkOrdinalSchema.parse("0000"),
				url: "https://news.example.com/unsub",
				status: "skipped",
				skipReason: "list-unsubscribe",
			},
		]);

		const response = await agent.get(articlesTabPath);

		const doc = parseDoc(response.text);
		const empty = doc.querySelector("[data-test-articles-empty]");
		assert(empty, "an all-skipped email must render the empty Articles panel");
		// "No links found in this email." would be false — one was found, then skipped.
		expect(empty.textContent?.trim()).toBe(
			"Every link in this email was skipped — see the Skipped tab.",
		);
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

	it("reveals only the first page of cards, with the control inside the appendable container", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, manyCrawledLinks(25));

		const response = await agent.get(articlesTabPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(Array.from(doc.querySelectorAll("[data-test-inbox-article-card]"))).toHaveLength(20);
		const control = doc.querySelector("[data-test-articles-show-more]");
		assert(control, "the Show more control must offer the remaining cards");
		expect(control.textContent).toBe("Show 5 more");
		expect(control.getAttribute("href")).toBe(`${detailPath}&tab=articles&shown=40`);
		expect(control.closest("[data-test-inbox-articles]")).not.toBeNull();
		expect(doc.querySelector("[data-test-inbox-detail-link-count]")?.textContent).toBe("25 links");
	});

	it("renders the cumulative reveal a no-JS Show more navigation asks for", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, manyCrawledLinks(25));

		const response = await agent.get(`${articlesTabPath}&shown=40`);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(Array.from(doc.querySelectorAll("[data-test-inbox-article-card]"))).toHaveLength(25);
		expect(doc.querySelector("[data-test-articles-show-more]")).toBeNull();
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

describe("Inbox email detail Skipped tab", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}?tab=excluded`);

		expect(response.status).toBe(404);
	});

	it("lists every skipped link with its reason and an include-feedback form, no email body", async () => {
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
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "crawled", title: "Kept article" },
			{
				ordinal: EmailLinkOrdinalSchema.parse("0001"),
				url: "https://news.example.com/unsub",
				status: "skipped",
				skipReason: "list-unsubscribe",
			},
			{
				ordinal: EmailLinkOrdinalSchema.parse("0002"),
				url: "https://sponsor.example.com/deal",
				status: "skipped",
				skipReason: "llm-ad",
			},
		]);

		const response = await agent.get(excludedTabPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(renderedPanels(doc)).toEqual(["excluded"]);
		const excludedTab = doc.querySelector('[data-test-inbox-tab="excluded"]');
		assert(excludedTab, "Skipped tab must render");
		expect(excludedTab.getAttribute("aria-current")).toBe("page");

		// The kept card belongs to the Articles tab and must not leak onto this one.
		expect(doc.querySelectorAll("[data-test-inbox-article-card]")).toHaveLength(0);
		// The header count still reports kept links, on every tab.
		expect(doc.querySelector("[data-test-inbox-detail-link-count]")?.textContent).toBe("1 link");

		const excludedRow = doc.querySelector('[data-test-inbox-excluded-link="0001"]');
		assert(excludedRow, "excluded row must render");
		const excludedUrl = excludedRow.querySelector("[data-test-inbox-excluded-url]");
		assert(excludedUrl, "excluded row must show its URL");
		// Never a hyperlink: a skipped link was never fetched, so the reader is not
		// invited to click it.
		expect(excludedUrl.tagName).toBe("SPAN");
		expect(excludedUrl.textContent).toBe("https://news.example.com/unsub");
		expect(excludedRow.querySelector("[data-test-inbox-excluded-reason]")?.textContent).toBe(
			"Unsubscribe link",
		);
		expect(
			doc
				.querySelector('[data-test-inbox-excluded-link="0002"]')
				?.querySelector("[data-test-inbox-excluded-reason]")?.textContent,
		).toBe("Advertisement");

		const includeButton = excludedRow.querySelector("[data-test-inbox-feedback-include]");
		assert(includeButton, "excluded row must offer include feedback");
		const includeForm = includeButton.closest("form");
		assert(includeForm, "include feedback must submit as a form");
		expect(includeForm.getAttribute("method")).toBe("POST");
		expect(includeForm.getAttribute("action")).toBe(
			`/inbox/${encodeURIComponent(SK)}/links/0001/feedback?feature=email`,
		);
		expect(includeForm.querySelector('input[name="verdict"]')?.getAttribute("value")).toBe(
			"should-be-included",
		);

		expect(bodyReads).toBe(0);
		expect(doc.querySelector("[data-test-inbox-email-iframe]")).toBeNull();
	});

	it("says nothing was skipped when every link was kept", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "crawled", title: "Kept article" },
		]);

		const response = await agent.get(excludedTabPath);

		const doc = parseDoc(response.text);
		const panel = doc.querySelector('[data-test-tab-panel="excluded"]');
		assert(panel, "the Skipped panel must render");
		expect(panel.getAttribute("data-excluded-status")).toBe("terminal");
		const empty = doc.querySelector("[data-test-excluded-empty]");
		assert(empty, "a nothing-skipped email must render the empty Skipped panel");
		expect(empty.textContent?.trim()).toBe("Nothing was skipped in this email.");
	});

	it("polls the Skipped panel rather than claiming nothing was skipped mid-extraction", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(excludedTabPath);

		const doc = parseDoc(response.text);
		const panel = doc.querySelector('[data-test-tab-panel="excluded"]');
		assert(panel, "the Skipped panel must render");
		expect(panel.getAttribute("data-excluded-status")).toBe("extracting");
		// Its own fragment: polling /articles would swap the Articles panel in here.
		expect(panel.getAttribute("hx-get")).toContain("/excluded");
		expect(doc.querySelector("[data-test-excluded-extracting]")).not.toBeNull();
		expect(doc.querySelector("[data-test-excluded-empty]")).toBeNull();
	});

	it("is terminally empty for an unparsed email, which never runs extraction", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "unparsed");

		const response = await agent.get(excludedTabPath);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		const panel = doc.querySelector('[data-test-tab-panel="excluded"]');
		assert(panel, "the Skipped panel must render");
		expect(panel.getAttribute("data-excluded-status")).toBe("terminal");
		expect(doc.querySelector("[data-test-excluded-empty]")?.textContent?.trim()).toBe(
			"No links found in this email.",
		);
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
		// The tab strip does NOT ride this tick: it would be byte-identical to the
		// one on screen, and an outerHTML swap replaces the tab links rather than
		// editing them, so a reader keyboarding through the tabs would lose focus
		// every few seconds until extraction finished.
		expect(doc.querySelector("[data-test-inbox-tabs]")).toBeNull();
	});

	it("fills the tab counts in on the poll tick that completes extraction", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "crawled", title: "Kept" },
			{
				ordinal: EmailLinkOrdinalSchema.parse("0001"),
				url: "https://news.example.com/unsub",
				status: "skipped",
				skipReason: "list-unsubscribe",
			},
		]);

		const response = await agent.get(`${articlesPath}&poll=1`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		// Without this OOB swap the counts would stay withheld until a full reload,
		// even though the panel it ships with already shows the finished card set.
		const tabs = doc.querySelector("[data-test-inbox-tabs]");
		assert(tabs, "the poll fragment must carry the OOB tab strip");
		expect(tabs.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(doc.querySelector('[data-test-inbox-tab="articles"]')?.textContent).toBe(
			"Extracted Articles (1)",
		);
		expect(doc.querySelector('[data-test-inbox-tab="excluded"]')?.textContent).toBe(
			"Skipped (1)",
		);
	});

	it("still ships the tab strip when extraction finishes having found nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedExtractionMeta(fixture);

		const response = await agent.get(`${articlesPath}&poll=1`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		// An email whose extraction kept nothing reports "(0)", and "(0)" is a
		// count — gating the swap on the header badge (which goes empty at zero)
		// would strand these tabs on their bare labels forever.
		const tabs = doc.querySelector("[data-test-inbox-tabs]");
		assert(tabs, "a finished extraction must ship the tab strip even with no links");
		expect(tabs.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(doc.querySelector('[data-test-inbox-tab="articles"]')?.textContent).toBe(
			"Extracted Articles (0)",
		);
		expect(doc.querySelector('[data-test-inbox-tab="excluded"]')?.textContent).toBe(
			"Skipped (0)",
		);
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

const excludedPath = `/inbox/${encodeURIComponent(SK)}/excluded?feature=email`;

describe("Inbox Skipped panel poll route", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}/excluded`);

		expect(response.status).toBe(404);
	});

	it("returns 404 for an email the user does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(excludedPath);

		expect(response.status).toBe(404);
	});

	it("keeps polling, with an incremented count, while extraction is pending", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(`${excludedPath}&poll=1`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = doc.querySelector('[data-test-tab-panel="excluded"]');
		assert(panel, "the panel fragment must render");
		expect(panel.getAttribute("data-excluded-status")).toBe("extracting");
		expect(panel.getAttribute("hx-get")).toContain("poll=2");
		// It must keep polling its OWN fragment: a shared URL would swap the Articles
		// panel in over this one on the first tick.
		expect(panel.getAttribute("hx-get")).toContain("/excluded");
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

		const response = await agent.get(`${excludedPath}&poll=301`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = doc.querySelector('[data-test-tab-panel="excluded"]');
		assert(panel, "the panel fragment must render");
		expect(panel.getAttribute("data-excluded-status")).toBe("stale");
		expect(panel.getAttribute("hx-get")).toBeNull();
		expect(doc.querySelector("[data-test-excluded-stale]")).not.toBeNull();
		expect(doc.querySelector("[data-test-excluded-extracting]")).toBeNull();
	});

	it("swaps in the finished skipped set once extraction wrote its meta", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "crawled", title: "Kept article" },
			{
				ordinal: EmailLinkOrdinalSchema.parse("0001"),
				url: "https://news.example.com/unsub",
				status: "skipped",
				skipReason: "list-unsubscribe",
			},
		]);

		const response = await agent.get(excludedPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = doc.querySelector('[data-test-tab-panel="excluded"]');
		assert(panel, "the panel fragment must render");
		expect(panel.getAttribute("data-excluded-status")).toBe("terminal");
		expect(panel.getAttribute("hx-get")).toBeNull();
		expect(doc.querySelectorAll("[data-test-inbox-excluded-link]")).toHaveLength(1);
		// The header badge counts kept links and has to catch up here too — this poll
		// is the only request in flight while the reader sits on this tab.
		const linkCount = doc.querySelector("[data-test-inbox-detail-link-count]");
		assert(linkCount, "the terminal poll fragment must carry the OOB link-count update");
		expect(linkCount.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(linkCount.textContent).toBe("1 link");
	});
});

describe("Inbox link feedback route", () => {
	const feedbackPath = `/inbox/${encodeURIComponent(SK)}/links/0000/feedback`;

	it("returns 404 without the email feature flag", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(feedbackPath).type("form").send({
			verdict: "should-be-included",
		});

		expect(response.status).toBe(404);
	});

	it("logs the feedback as an error and redirects back to the Skipped tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{
				url: "https://news.example.com/unsub",
				status: "skipped",
				skipReason: "list-unsubscribe",
			},
		]);

		const response = await agent.post(`${feedbackPath}?feature=email`).type("form").send({
			verdict: "should-be-included",
		});

		expect(response.status).toBe(303);
		// Back to the tab the reported row lives on — a skipped link is on Skipped
		// Links, so a fixed &tab=articles would land the reader on a panel that
		// doesn't hold it.
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=excluded&feedback=sent`,
		);
		const confirmation = await agent.get(response.headers.location);
		const notice = parseDoc(confirmation.text).querySelector(
			"[data-test-inbox-feedback-notice]",
		);
		assert(notice, "the followed redirect must confirm the report");
		expect(notice.textContent?.trim()).toBe("Thanks — your report was logged.");
		expect(errors).toHaveLength(1);
		assert(errors[0].startsWith("[inbox-link-feedback] "));
		expect(JSON.parse(errors[0].slice("[inbox-link-feedback] ".length))).toMatchObject({
			verdict: "should-be-included",
			receivedAtMessageId: SK,
			ordinal: "0000",
			url: "https://news.example.com/unsub",
			status: "skipped",
			skipReason: "list-unsubscribe",
		});
	});

	it("redirects an exclude verdict on a kept link back to the Articles tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [{ status: "crawled", title: "Kept article" }]);

		const response = await agent.post(`${feedbackPath}?feature=email`).type("form").send({
			verdict: "should-be-excluded",
		});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles&feedback=sent`,
		);
		const confirmation = await agent.get(response.headers.location);
		const notice = parseDoc(confirmation.text).querySelector("[data-test-inbox-feedback-notice]");
		assert(notice, "the followed redirect must confirm the report on the Articles tab");
		expect(errors).toHaveLength(1);
	});

	it("picks the tab from the link's status, not from the verdict", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.logError = () => {};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [
			{ url: "https://news.example.com/unsub", status: "skipped", skipReason: "list-unsubscribe" },
		]);

		// Crossed on purpose: every other case pairs a skipped link with an include
		// verdict, so keying the redirect off the verdict would pass them all. The row
		// is skipped, so it is on the Skipped tab whatever the reader claims.
		const response = await agent.post(`${feedbackPath}?feature=email`).type("form").send({
			verdict: "should-be-excluded",
		});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=excluded&feedback=sent`,
		);
	});

	it("returns 404 for a link that does not exist", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent
			.post(`/inbox/${encodeURIComponent(SK)}/links/0009/feedback?feature=email`)
			.type("form")
			.send({ verdict: "should-be-included" });

		expect(response.status).toBe(404);
		expect(errors).toHaveLength(0);
	});

	it("returns 404 for an ordinal that is not four digits", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent
			.post(`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/feedback?feature=email`)
			.type("form")
			.send({ verdict: "should-be-included" });

		expect(response.status).toBe(404);
	});

	it("redirects without logging when the verdict is malformed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");
		await seedLinks(fixture, [{ status: "pending" }]);

		const response = await agent.post(`${feedbackPath}?feature=email`).type("form").send({
			verdict: "not-a-verdict",
		});

		expect(response.status).toBe(303);
		expect(errors).toHaveLength(0);
	});
});
