import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	InboxAddressSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	MessageIdSchema,
	formatEmailLinkOrdinal,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const MEMBER_PATHS = ["/inbox", "/inbox/addresses"];

const EMAIL_COUNT = 11;
const KEPT_LINK_COUNT = 21;
const SKIPPED_LINK_COUNT = 2;

function untrackedOn(page: { path: string; html: string }): string[] {
	return describeUntrackedCtas(findUntrackedCtas(page.html, { skipSelectors: [] })).map(
		(line) => `${page.path}  ${line}`,
	);
}

function emailEntry(userId: UserId, index: number): InboxEmailEntry {
	const messageId = MessageIdSchema.parse(`<m-${index}@x>`);
	const receivedAt = new Date(Date.UTC(2026, 5, 24, 0, index)).toISOString();
	return {
		userId,
		receivedAtMessageId: `${receivedAt}#${messageId}`,
		messageId,
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: `sender-${index}@example.com`,
		subject: `Issue ${index}`,
		status: "received",
		receivedAt,
		rawEmailS3Key: `inbound/${messageId}`,
		bodyS3Key: `content/${messageId}/content.html`,
		linkCounts: undefined,
	};
}

function linkEntry(input: {
	email: InboxEmailEntry;
	index: number;
	link: Pick<InboxEmailLinkEntry, "status" | "title" | "skipReason">;
}): InboxEmailLinkEntry {
	return {
		userId: input.email.userId,
		receivedAtMessageId: input.email.receivedAtMessageId,
		ordinal: formatEmailLinkOrdinal(input.index),
		url: `https://example.com/post-${input.index}`,
		resolvedUrl: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		droppedFor: undefined,
		...input.link,
	};
}

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the inbox surfaces", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const untracked: string[] = [];
		for (const path of MEMBER_PATHS) {
			const response = await agent.get(path);
			untracked.push(...untrackedOn({ path, html: response.text }));
		}

		expect(untracked).toEqual([]);
	});

	it("holds across a filled inbox: its older page, an email's tabs and both address groups", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>Newsletter body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const user = await fixture.auth.findUserByEmail("test@example.com");
		assert(user, "logged-in user must exist before seeding");

		await agent.post("/inbox/create").type("form").send({ name: "kept" });
		await agent.post("/inbox/create").type("form").send({ name: "retired" });
		const retired = (
			await fixture.inboxAddress.inboxAddressStore.listAddressesByUserId(user.userId)
		).find((entry) => entry.name === "retired");
		assert(retired, "the second created address must exist");
		await agent.post("/inbox/disable").type("form").send({ address: retired.address });

		const emails = Array.from({ length: EMAIL_COUNT }, (_unused, index) =>
			emailEntry(user.userId, index),
		);
		for (const email of emails) {
			await fixture.inboxEmail.inboxEmailStore.putEmail(email);
		}
		const newest = emails[EMAIL_COUNT - 1];
		const links = [
			...Array.from({ length: KEPT_LINK_COUNT }, (_unused, index) =>
				linkEntry({
					email: newest,
					index,
					link: { status: "crawled", title: `Post ${index}`, skipReason: undefined },
				}),
			),
			...Array.from({ length: SKIPPED_LINK_COUNT }, (_unused, offset) =>
				linkEntry({
					email: newest,
					index: KEPT_LINK_COUNT + offset,
					link: { status: "skipped", title: undefined, skipReason: "list-unsubscribe" },
				}),
			),
		];
		for (const link of links) {
			await fixture.inboxEmail.inboxEmailLinkStore.putLink(link);
		}
		await fixture.inboxEmail.inboxEmailStore.setEmailLinkCounts({
			userId: user.userId,
			receivedAtMessageId: newest.receivedAtMessageId,
			linkCounts: { kept: KEPT_LINK_COUNT, skipped: SKIPPED_LINK_COUNT, truncated: false },
		});
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId: user.userId,
			receivedAtMessageId: newest.receivedAtMessageId,
			meta: { truncated: false, extractionFailed: false, readlistDecision: undefined },
		});

		const firstPage = (await agent.get("/inbox")).text;
		const olderHref = new JSDOM(firstPage).window.document
			.querySelector('[data-test-pagination-link="older"]')
			?.getAttribute("href");
		assert(olderHref, "a full first page must link to the older page");
		const detailPath = `/inbox/${encodeURIComponent(newest.receivedAtMessageId)}`;
		const walked = [{ path: "/inbox", html: firstPage }];
		for (const path of [
			olderHref,
			"/inbox/addresses",
			detailPath,
			`${detailPath}?tab=articles`,
			`${detailPath}?tab=excluded`,
		]) {
			walked.push({ path, html: (await agent.get(path)).text });
		}
		const untracked = walked.flatMap(untrackedOn);
		const [, olderPage, addressesPage, viewTab, articlesTab, skippedTab] = walked.map(
			({ html }) => new JSDOM(html).window.document,
		);

		expect(olderPage.querySelectorAll('[data-test-pagination-link="newer"]')).toHaveLength(1);
		expect(addressesPage.querySelectorAll("form.inbox__disable")).toHaveLength(1);
		expect(addressesPage.querySelectorAll("form.inbox__enable")).toHaveLength(1);
		expect(viewTab.querySelector("[data-test-inbox-email-iframe]")).not.toBeNull();
		expect(articlesTab.querySelector("[data-test-articles-show-more]")).not.toBeNull();
		expect(articlesTab.querySelector('[data-test-card-action="feedback-exclude"]')).not.toBeNull();
		expect(skippedTab.querySelectorAll("[data-test-inbox-excluded-save]")).toHaveLength(
			SKIPPED_LINK_COUNT,
		);
		expect(untracked).toEqual([]);
	});
});
