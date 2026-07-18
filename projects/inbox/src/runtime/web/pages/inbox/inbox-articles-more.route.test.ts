import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	InboxAddressSchema,
	MessageIdSchema,
	formatEmailLinkOrdinal,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const SK = "2026-06-24T09:00:00.000Z#<more@x>";

function emailEntry(userId: UserId): InboxEmailEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		messageId: MessageIdSchema.parse("<more@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/more",
		bodyS3Key: "content/more/content.html",
	};
}

function linkEntry(userId: UserId, overrides: Partial<InboxEmailLinkEntry>): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: formatEmailLinkOrdinal(0),
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
	links: Partial<InboxEmailLinkEntry>[],
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailStore.putEmail(emailEntry(user.userId));
	for (const link of links) {
		await fixture.inboxEmail.inboxEmailLinkStore.putLink(linkEntry(user.userId, link));
	}
	await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
		userId: user.userId,
		receivedAtMessageId: SK,
		meta: { truncated: false },
	});
}

function crawled(count: number, startIndex = 0): Partial<InboxEmailLinkEntry>[] {
	return Array.from({ length: count }, (_unused, index) => ({
		ordinal: formatEmailLinkOrdinal(startIndex + index),
		url: `https://example.com/post-${startIndex + index}`,
		status: "crawled" as const,
		title: `Post ${startIndex + index}`,
	}));
}

function parseDoc(html: string) {
	return new JSDOM(`<div>${html}</div>`).window.document;
}

function cardOrdinals(doc: ReturnType<typeof parseDoc>): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-inbox-article-card]")).map((card) =>
		card.getAttribute("data-test-inbox-article-card"),
	);
}

const morePath = `/inbox/${encodeURIComponent(SK)}/articles/more?feature=email`;

describe("Inbox Extracted Articles Show more fragment", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}/articles/more?shown=40`);

		expect(response.status).toBe(404);
	});

	it("returns 404 for an email the user does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`${morePath}&shown=40`);

		expect(response.status).toBe(404);
	});

	it("appends only the next page of cards and re-offers a control for the remainder", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, crawled(45));

		const response = await agent.get(`${morePath}&shown=40`);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(cardOrdinals(doc)).toEqual(
			Array.from({ length: 20 }, (_unused, index) => formatEmailLinkOrdinal(20 + index)),
		);
		const control = doc.querySelector("[data-test-articles-show-more]");
		assert(control, "a control must re-offer the remaining cards");
		expect(control.textContent).toBe("Show 5 more");
		expect(control.getAttribute("hx-get")).toBe(`${morePath}&shown=60`);
		expect(control.getAttribute("hx-swap")).toBe("outerHTML");
		expect(control.getAttribute("href")).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles&shown=60`,
		);
	});

	it("drops the control once the last card is revealed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, crawled(25));

		const response = await agent.get(`${morePath}&shown=40`);

		expect(response.status).toBe(200);
		const doc = parseDoc(response.text);
		expect(cardOrdinals(doc)).toEqual(["0020", "0021", "0022", "0023", "0024"]);
		expect(doc.querySelector("[data-test-articles-show-more]")).toBeNull();
	});

	it("keeps a revealed pending card polling for its preview", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, [...crawled(20), { ordinal: formatEmailLinkOrdinal(20) }]);

		const response = await agent.get(`${morePath}&shown=40`);

		const doc = parseDoc(response.text);
		const card = doc.querySelector('[data-test-inbox-article-card="0020"]');
		assert(card, "the revealed pending card must render");
		expect(card.getAttribute("hx-get")).toContain("/links/0020/card");
		expect(card.getAttribute("hx-trigger")).toBe("every 3s");
	});

	it("never reveals an excluded link as a card", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, [
			...crawled(20),
			{ ordinal: formatEmailLinkOrdinal(20), status: "skipped", skipReason: "llm-ad" },
			...crawled(1, 21),
		]);

		const response = await agent.get(`${morePath}&shown=40`);

		const doc = parseDoc(response.text);
		expect(cardOrdinals(doc)).toEqual(["0021"]);
		expect(doc.querySelector("[data-test-inbox-excluded-link]")).toBeNull();
	});
});
