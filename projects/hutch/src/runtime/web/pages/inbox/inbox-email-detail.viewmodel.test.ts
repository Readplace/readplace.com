import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailStatus,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";

const SK = "2026-06-24T09:00:00.000Z#<m@x>";

function entry(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
		receivedAtMessageId: SK,
		messageId: MessageIdSchema.parse("<m@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/m",
		bodyS3Key: "content/m/content.html",
		...overrides,
	};
}

function link(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
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

function build(input: {
	entry?: InboxEmailEntry;
	bodyHtml?: string | undefined;
	links?: InboxEmailLinkEntry[];
	linksMeta?: { truncated: boolean } | undefined;
	panelPollCount?: number;
}) {
	return toInboxEmailDetailViewModel({
		entry: input.entry ?? entry(),
		bodyHtml: input.bodyHtml,
		links: input.links ?? [],
		linksMeta: input.linksMeta,
		maxPolls: 300,
		panelPollCount: input.panelPollCount,
	});
}

describe("toInboxEmailDetailViewModel", () => {
	it("renders the body for a received email with content, View tab active", () => {
		const vm = build({ entry: entry({ status: "received" }), bodyHtml: "<p>hi</p>" });

		expect(vm.canRenderBody).toBe(true);
		expect(vm.bodyHtml).toBe("<p>hi</p>");
		expect(vm.tabs[0].ariaCurrent).toBe("page");
	});

	it("exposes the received instant as a UTC-baselined datetime LocalTime", () => {
		const vm = build({
			entry: entry({ receivedAt: "2026-06-24T09:00:00.000Z" }),
			bodyHtml: "<p>hi</p>",
		});

		expect(vm.received).toEqual({
			iso: "2026-06-24T09:00:00.000Z",
			label: "Jun 24, 2026, 09:00 UTC",
			mode: "datetime",
		});
	});

	it("shows the unavailable panel for a received email whose body is not readable", () => {
		const vm = build({ entry: entry({ status: "received" }), bodyHtml: undefined });

		expect(vm.canRenderBody).toBe(false);
		expect(vm.bodyHtml).toBe("");
	});

	it("never renders the body for a rejected or unparsed email", () => {
		const statuses: InboxEmailStatus[] = ["rejected", "unparsed"];
		for (const status of statuses) {
			const vm = build({ entry: entry({ status }), bodyHtml: "<p>should be ignored</p>" });
			expect(vm.canRenderBody).toBe(false);
		}
	});

	it("falls back to placeholders for an empty sender or subject", () => {
		const vm = build({ entry: entry({ senderEmail: "", subject: "" }), bodyHtml: undefined });

		expect(vm.sender).toBe("(unknown sender)");
		expect(vm.subject).toBe("(no subject)");
	});

	it("treats a received email with no meta row as still extracting, not terminally empty", () => {
		const vm = build({ links: [], linksMeta: undefined });

		expect(vm.articles.isExtracting).toBe(true);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.panelPollUrl).toContain("/articles?feature=email&poll=1");
		// The header count is held back until extraction writes its barrier.
		expect(vm.linkCountLabel).toBeUndefined();
	});

	it("gives up to a terminal stale state once the budget is spent without a meta barrier", () => {
		const vm = build({ links: [], linksMeta: undefined, panelPollCount: 301 });

		// A permanent extract-DLQ failure or a pre-feature email never writes its
		// meta barrier, so the spinner must terminate rather than poll forever.
		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isStalePending).toBe(true);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		// No trustworthy count while extraction never finished.
		expect(vm.linkCountLabel).toBeUndefined();
	});

	it("stays extracting on the last budgeted poll, before the give-up threshold", () => {
		const vm = build({ links: [], linksMeta: undefined, panelPollCount: 300 });

		expect(vm.articles.isExtracting).toBe(true);
		expect(vm.articles.isStalePending).toBe(false);
		expect(vm.articles.panelPollUrl).toContain("poll=300");
	});

	it("never polls a non-received email's articles panel", () => {
		const vm = build({ entry: entry({ status: "rejected" }), links: [], linksMeta: undefined });

		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.panelPollUrl).toBeUndefined();
	});

	it("reports a genuinely empty panel once extraction wrote its meta with zero links", () => {
		const vm = build({ links: [], linksMeta: { truncated: false } });

		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.cards).toHaveLength(0);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.articles.truncatedNotice).toBeUndefined();
	});

	it("maps a pending link to a polling card and a crawled link to a terminal card", () => {
		const vm = build({
			linksMeta: { truncated: false },
			links: [
				link({ ordinal: EmailLinkOrdinalSchema.parse("0000"), status: "pending" }),
				link({
					ordinal: EmailLinkOrdinalSchema.parse("0001"),
					status: "crawled",
					title: "A title",
					excerpt: "An excerpt",
					siteName: "Example",
					imageUrl: "https://cdn.test/x.jpg",
				}),
			],
		});

		expect(vm.articles.isEmpty).toBe(false);
		expect(vm.linkCountLabel).toBe("2 links");
		const [pending, crawled] = vm.articles.cards;
		expect(pending.status).toBe("pending");
		expect(pending.cardPollUrl).toContain("/inbox/");
		expect(pending.cardPollUrl).toContain("/links/0000/card");
		expect(crawled.status).toBe("crawled");
		expect(crawled.title).toBe("A title");
		expect(crawled.cardPollUrl).toBeUndefined();
	});

	it("maps a failed link to a terminal card and surfaces a truncated notice", () => {
		const vm = build({
			links: [link({ status: "failed", failureReason: "crawl-failed" })],
			linksMeta: { truncated: true },
		});

		expect(vm.articles.cards[0].status).toBe("failed");
		expect(vm.articles.cards[0].cardPollUrl).toBeUndefined();
		expect(vm.articles.truncatedNotice).toBe("Showing the first 1 links found in this email.");
		expect(vm.linkCountLabel).toBe("1+ links");
	});
});
