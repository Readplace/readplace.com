import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
// A second harness whose publish always rejects, to prove the mark runs after the
// publish: a failed publish must leave the link unmarked (under-promise) rather
// than marking a save that never happened (over-promise).
const usePublishFailsApp = useTestServer({
	publishSubmitLink: async () => {
		throw new Error("submit publish failed");
	},
});
const SK = "2026-06-24T09:00:00.000Z#<save@x>";

function link(userId: UserId, overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "crawled",
		title: "A post",
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		submittedAt: undefined,
		...overrides,
	};
}

function email(userId: UserId): InboxEmailEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		messageId: MessageIdSchema.parse("<save@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/save",
		bodyS3Key: "content/save/content.html",
		linkCounts: undefined,
	};
}

/** Seeds the owning email as well as the link, so a test can follow the save's
 * redirect and assert on the page it lands on rather than only its Location. */
async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	overrides: Partial<InboxEmailLinkEntry> = {},
): Promise<UserId> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailStore.putEmail(email(user.userId));
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(link(user.userId, overrides));
	return user.userId;
}

const savePath = `/inbox/${encodeURIComponent(SK)}/links/0000/save`;

describe("Inbox link save route", () => {
	it("publishes a submit for the stored link and redirects back to the Articles tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});

	it("confirms the save on the followed redirect as a dismissable status toast", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath);
		const confirmation = await agent.get(response.headers.location);

		const doc = new JSDOM(confirmation.text).window.document;
		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "the followed redirect must confirm the save");
		// Present tense: the route only publishes SubmitLinkCommand — the queue row
		// is written by a downstream subscriber.
		expect(doc.querySelector("[data-test-toast-message]")?.textContent?.trim()).toBe(
			"Adding to your queue…",
		);
		// role/aria-live carry the announcement; data-dismiss is what the global
		// toast script reads to fade it out, so a stale flag can't pin it on screen.
		expect(toast.getAttribute("role")).toBe("status");
		expect(toast.getAttribute("aria-live")).toBe("polite");
		expect(toast.getAttribute("data-dismiss")).toBe("6000");
	});

	it("marks the link submitted so the saved card stays distinct after the toast fades", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		await agent.post(savePath);

		const saved = await fixture.inboxEmail.inboxEmailLinkStore.getLink({
			userId,
			receivedAtMessageId: SK,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(saved, "the saved link must still exist");
		expect(saved.submittedAt).toBeDefined();
	});

	it("shows the durable sent marker on the followed redirect, not just the toast", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);
		// The meta barrier makes the Articles panel terminal, so it renders cards
		// rather than the "Looking for links…" extracting notice.
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId,
			receivedAtMessageId: SK,
			meta: { truncated: false },
		});

		const response = await agent.post(savePath);
		const confirmation = await agent.get(response.headers.location);

		const card = new JSDOM(confirmation.text).window.document.querySelector(
			'[data-test-inbox-article-card="0000"]',
		);
		assert(card, "the saved card must render on the redirect target");
		const marker = card.querySelector("[data-test-card-saved]");
		assert(marker, "the saved card must carry its sent marker");
		expect(marker.getAttribute("data-test-card-saved")).toBe("sent");
		expect(marker.classList.contains("inbox-article-card__saved--sent")).toBe(true);
		expect(marker.textContent).toBe("Sent to your queue");
		// The Save button is gone once sent — only the report action remains.
		expect(card.querySelector('[data-test-card-action="save"]')).toBe(null);
	});

	it("keeps the sent marker on a plain reload, where a card is byte-identical to its poll swap", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, { submittedAt: "2026-07-01T00:00:00.000Z" });
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId,
			receivedAtMessageId: SK,
			meta: { truncated: false },
		});

		const plain = await agent.get(`/inbox/${encodeURIComponent(SK)}?tab=articles`);

		const card = new JSDOM(plain.text).window.document.querySelector(
			'[data-test-inbox-article-card="0000"]',
		);
		assert(card, "the pre-submitted card must render on a plain GET");
		expect(card.querySelector("[data-test-card-saved]")?.getAttribute("data-test-card-saved")).toBe(
			"sent",
		);
		expect(card.querySelector('[data-test-card-action="save"]')).toBe(null);
	});

	it("does not re-publish an already-submitted link, so a stale second-tab save can't resurrect it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		await agent.post(savePath);
		const second = await agent.post(savePath);

		expect(second.status).toBe(303);
		expect(second.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});

	it("leaves the link unmarked when the publish fails, so a saved card never over-promises", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = usePublishFailsApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(500);
		const link = await fixture.inboxEmail.inboxEmailLinkStore.getLink({
			userId,
			receivedAtMessageId: SK,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(link, "the seeded link must still exist");
		expect(link.submittedAt).toBeUndefined();
	});

	it("renders no toast on a plain view of the same page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const plain = await agent.get(
			`/inbox/${encodeURIComponent(SK)}?tab=articles`,
		);

		expect(new JSDOM(plain.text).window.document.querySelector("[data-test-toast]")).toBe(null);
	});

	it("carries the expanded page size back so the saved card keeps its place in the list", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).type("form").send({ shown: "40" });

		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&shown=40&saved=1`,
		);
	});

	it("submits the stored URL even when the preview resolved elsewhere — the save pipeline owns redirects", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, { resolvedUrl: "https://cdn.example.com/final" });

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});

	it("strips the newsletter's utm tags from a crawled link before submitting it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			url: "https://example.com/post?id=7&utm_source=nl&utm_medium=email",
		});

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post?id=7" }]);
	});

	it("submits a pending wrapper byte-exact, so a signed query survives the redirect chain", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			status: "pending",
			title: undefined,
			url: "https://link.mail.example.com/ss/c/token?utm_source=nl",
		});

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://link.mail.example.com/ss/c/token?utm_source=nl" },
		]);
	});

	it("returns 404 for an unknown link and publishes nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a skipped link — its row renders without a Save button", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "llm-ad", title: undefined });

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a malformed ordinal and publishes nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(
			`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/save`,
		);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a link the save pipeline would reject", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { url: "https://localhost/private" });

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});
});
