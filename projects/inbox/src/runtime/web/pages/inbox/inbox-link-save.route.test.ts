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

describe("Inbox link save route with a relayed publisher", () => {
	// The e2e harness stands in for the deployed round trip — publish, accept,
	// LinkQueued, read model — so the Saved chip can appear against an in-memory
	// stack. This pins that seam from the same route a reader would use.
	const relayed: Array<{ userId: string; url: string }> = [];
	const useRelayingApp = useTestServer({
		publishSubmitLink: async (input) => {
			relayed.push(input);
		},
	});

	it("relays the submitted link to the injected publisher as well as recording it", async () => {
		relayed.length = 0;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useRelayingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(relayed).toEqual([{ userId, url: "https://example.com/post" }]);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});
});
