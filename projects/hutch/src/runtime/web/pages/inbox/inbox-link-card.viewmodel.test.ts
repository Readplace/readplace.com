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
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
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
	});

	it("stops polling once a link reaches a terminal state", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({
				status: "crawled",
				title: "T",
				excerpt: "E",
				siteName: "S",
				imageUrl: "https://cdn.test/x.jpg",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
		});

		expect(crawled.cardPollUrl).toBeUndefined();
		expect(crawled.title).toBe("T");
		expect(crawled.imageUrl).toBe("https://cdn.test/x.jpg");
	});

	it("stops polling a still-pending link once the poll budget is spent", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
		});

		expect(vm.cardPollUrl).toBeUndefined();
	});
});
