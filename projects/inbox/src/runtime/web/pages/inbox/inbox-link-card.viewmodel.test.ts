import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const SHOWN = 20;

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
			shown: SHOWN,
		});

		expect(vm.cardPollUrl).toContain("/links/0002/card");
		expect(vm.cardPollUrl).toContain("poll=1");
		// The re-rendered card has to keep posting the page size back, so a save
		// from an expanded list still returns the reader to the same page.
		expect(vm.cardPollUrl).toContain("shown=20");
		expect(vm.title).toBe("");
		expect(vm.hasTitle).toBe(false);
		expect(vm.actions.map((action) => [action.key, action.href])).toEqual([
			["save", `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/save`],
			[
				"feedback-exclude",
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/feedback`,
			],
		]);
	});

	it("posts the panel's page size back from every action, so neither loses the reader's place", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "T" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: 40,
		});

		expect(vm.actions.map((action) => [action.key, action.hiddenParams])).toEqual([
			["save", { shown: "40" }],
			["feedback-exclude", { shown: "40", verdict: "should-be-excluded" }],
		]);
	});

	it("offers no save action for a link the save pipeline would reject", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ url: "https://localhost/private" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
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
			shown: SHOWN,
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
			shown: SHOWN,
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
			shown: SHOWN,
		});

		expect(crawled.url).toBe("https://destination.test/the-actual-article");
	});

	it("drops the newsletter's utm tags from a crawled link that never redirected", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({
				status: "crawled",
				title: "T",
				url: "https://example.com/post?id=7&utm_source=nl&utm_medium=email",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(crawled.url).toBe("https://example.com/post?id=7");
	});

	it("drops utm tags the redirect destination itself carries", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({
				status: "crawled",
				title: "T",
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				resolvedUrl: "https://destination.test/article?utm_campaign=weekly&ref=nodeweekly",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(crawled.url).toBe("https://destination.test/article?ref=nodeweekly");
		expect(crawled.actions.map((action) => action.ariaLabel)).toEqual([
			"Save to queue: https://destination.test/article?ref=nodeweekly",
			"Not an article (report): https://destination.test/article?ref=nodeweekly",
		]);
	});

	it("shows a pending wrapper byte-exact, since stripping could break a signed query", () => {
		const pending = toInboxLinkCardViewModel({
			link: link({
				status: "pending",
				url: "https://link.mail.example.com/ss/c/token?utm_source=nl",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(pending.url).toBe("https://link.mail.example.com/ss/c/token?utm_source=nl");
	});

	it("treats a crawled link whose page had no title as a bare row", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: undefined }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
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
			shown: SHOWN,
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
			shown: SHOWN,
		});

		expect(vm.cardPollUrl).toBeUndefined();
		expect(vm.hasTitle).toBe(false);
	});

	it("tells the reader a preview is on its way while the card is still polling", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(vm.statusState).toBe("working");
		expect(vm.statusLabel).toBe("Fetching preview…");
	});

	it("distinguishes a pending link that spent its poll budget from one that finished", () => {
		const stalled = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN,
		});
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "Done" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN,
		});

		// Both stopped polling, so cardPollUrl alone cannot tell them apart.
		expect(stalled.cardPollUrl).toBeUndefined();
		expect(crawled.cardPollUrl).toBeUndefined();
		expect(stalled.statusState).toBe("stalled");
		expect(crawled.statusState).toBe("none");
	});

	it("marks a failed crawl so a bare URL is not mistaken for one still arriving", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "failed", failureReason: "timeout" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(vm.statusState).toBe("failed");
		expect(vm.statusLabel).toBe("No preview available");
	});

	it("says nothing on a crawled card, where the title is the signal", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "A real title" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(vm.statusState).toBe("none");
		expect(vm.statusLabel).toBe("");
	});

	it("keeps the card and action ids identical across a poll swap so focus can be restored", () => {
		const pending = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "Now resolved" }),
			emailId: EMAIL_ID,
			pollCount: 2,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(crawled.domId).toBe(pending.domId);
		expect(crawled.actions.map((a) => a.buttonId)).toEqual(
			pending.actions.map((a) => a.buttonId),
		);
	});

	it("gives each card on the page its own ids so a swap cannot reattach focus to a sibling", () => {
		const first = toInboxLinkCardViewModel({
			link: link({ ordinal: EmailLinkOrdinalSchema.parse("0002") }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});
		const second = toInboxLinkCardViewModel({
			link: link({ ordinal: EmailLinkOrdinalSchema.parse("0003") }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN,
		});

		expect(first.domId).toBe("inbox-card-0002");
		expect(second.domId).toBe("inbox-card-0003");
		expect(first.actions.map((a) => a.buttonId)).toEqual([
			"inbox-card-0002-save",
			"inbox-card-0002-feedback-exclude",
		]);
	});
});
