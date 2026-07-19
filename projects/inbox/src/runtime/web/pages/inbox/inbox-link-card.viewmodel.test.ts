import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";

function link(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
		receivedAtMessageId: EMAIL_ID,
		ordinal: EmailLinkOrdinalSchema.parse("0002"),
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

describe("toInboxLinkCardViewModel", () => {
	it("keeps polling a pending link below the poll budget", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(vm.cardPollUrl).toContain("/links/0002/card");
		expect(vm.cardPollUrl).toContain("poll=1");
		expect(vm.title).toBe("");
		expect(vm.hasTitle).toBe(false);
		expect(vm.actions.map((action) => [action.key, action.href])).toEqual([
			["save", `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/save?feature=email`],
			[
				"feedback-exclude",
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/feedback?feature=email`,
			],
		]);
	});

	it("offers no save action for a link the save pipeline would reject", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ url: "https://localhost/private" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(vm.actions.map((action) => action.key)).toEqual(["feedback-exclude"]);
	});

	it("labels the save action with the destination the card shows, not the tracking link", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({
				status: "crawled",
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				resolvedUrl: "https://destination.test/the-actual-article",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(vm.actions[0]?.ariaLabel).toBe(
			"Save to queue: https://destination.test/the-actual-article",
		);
	});

	it("stops polling once a link reaches a terminal state", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "T" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(crawled.cardPollUrl).toBeUndefined();
		expect(crawled.title).toBe("T");
		expect(crawled.hasTitle).toBe(true);
		expect(crawled.url).toBe("https://example.com/post");
	});

	it("shows the post-redirect destination instead of the newsletter tracking link once resolved", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({
				status: "crawled",
				title: "T",
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				resolvedUrl: "https://destination.test/the-actual-article",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(crawled.url).toBe("https://destination.test/the-actual-article");
	});

	it("treats a crawled link whose page had no title as a bare row", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: undefined }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(crawled.cardPollUrl).toBeUndefined();
		expect(crawled.hasTitle).toBe(false);
	});

	it("treats a skipped link as terminal so its card never polls", () => {
		const skipped = toInboxLinkCardViewModel({
			link: link({ status: "skipped", skipReason: "list-unsubscribe" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(skipped.cardPollUrl).toBeUndefined();
		expect(skipped.hasTitle).toBe(false);
	});

	it("stops polling a still-pending link once the poll budget is spent", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
		});

		expect(vm.cardPollUrl).toBeUndefined();
		expect(vm.hasTitle).toBe(false);
	});
});
