import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailStatus,
	InboxAddressSchema,
	MessageIdSchema,
	formatEmailLinkOrdinal,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { ARTICLES_PAGE_SIZE } from "./inbox-articles-more.url";
import type { MailTabKey } from "./inbox-email-detail.url";
import {
	toInboxArticlesMoreViewModel,
	toInboxEmailDetailViewModel,
} from "./inbox-email-detail.viewmodel";

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
		skipReason: undefined,
		...overrides,
	};
}

function build(input: {
	entry?: InboxEmailEntry;
	activeTab?: MailTabKey;
	bodyHtml?: string | undefined;
	links?: InboxEmailLinkEntry[];
	linksMeta?: { truncated: boolean } | undefined;
	shown?: number;
	panelPollCount?: number;
}) {
	return toInboxEmailDetailViewModel({
		entry: input.entry ?? entry(),
		activeTab: input.activeTab ?? "view",
		bodyHtml: input.bodyHtml,
		links: input.links ?? [],
		linksMeta: input.linksMeta,
		maxPolls: 300,
		shown: input.shown,
		panelPollCount: input.panelPollCount,
	});
}

function crawledLinks(count: number, startIndex = 0): InboxEmailLinkEntry[] {
	return Array.from({ length: count }, (_unused, index) =>
		link({
			ordinal: formatEmailLinkOrdinal(startIndex + index),
			url: `https://example.com/post-${startIndex + index}`,
			status: "crawled",
			title: `Post ${startIndex + index}`,
			excerpt: "An excerpt",
			siteName: "Example",
		}),
	);
}

describe("toInboxEmailDetailViewModel", () => {
	it("renders the body for a received email with content, View tab active", () => {
		const vm = build({ entry: entry({ status: "received" }), bodyHtml: "<p>hi</p>" });

		expect(vm.canRenderBody).toBe(true);
		expect(vm.bodyHtml).toBe("<p>hi</p>");
		expect(vm.activeTab).toBe("view");
		expect(vm.tabs[0].ariaCurrent).toBe("page");
	});

	it("hands the Articles tab to the page as the active one", () => {
		const vm = build({ activeTab: "articles", linksMeta: { truncated: false } });

		expect(vm.activeTab).toBe("articles");
		expect(vm.tabs[1].ariaCurrent).toBe("page");
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
		expect(pending.hasTitle).toBe(false);
		expect(pending.cardPollUrl).toContain("/inbox/");
		expect(pending.cardPollUrl).toContain("/links/0000/card");
		expect(crawled.hasTitle).toBe(true);
		expect(crawled.title).toBe("A title");
		expect(crawled.cardPollUrl).toBeUndefined();
	});

	it("maps a failed link to a terminal card and surfaces a truncated notice", () => {
		const vm = build({
			links: [link({ status: "failed", failureReason: "crawl-failed" })],
			linksMeta: { truncated: true },
		});

		expect(vm.articles.cards[0].hasTitle).toBe(false);
		expect(vm.articles.cards[0].cardPollUrl).toBeUndefined();
		expect(vm.articles.truncatedNotice).toBe("Showing the first 1 links found in this email.");
		expect(vm.linkCountLabel).toBe("1+ links");
	});

	it("routes skipped links to the excluded list and counts only the kept ones", () => {
		const vm = build({
			links: [
				link({ status: "pending" }),
				link({
					ordinal: EmailLinkOrdinalSchema.parse("0001"),
					url: "https://news.example.com/unsub",
					status: "skipped",
					skipReason: "list-unsubscribe",
				}),
				link({
					ordinal: EmailLinkOrdinalSchema.parse("0002"),
					url: "https://sponsor.example.com/deal",
					status: "skipped",
					skipReason: "llm-ad",
				}),
			],
			linksMeta: { truncated: false },
		});

		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0000"]);
		expect(vm.articles.excluded).toEqual([
			{
				ordinal: "0001",
				url: "https://news.example.com/unsub",
				reasonLabel: "Unsubscribe link",
				feedbackAction: `/inbox/${encodeURIComponent(SK)}/links/0001/feedback?feature=email`,
			},
			{
				ordinal: "0002",
				url: "https://sponsor.example.com/deal",
				reasonLabel: "Advertisement",
				feedbackAction: `/inbox/${encodeURIComponent(SK)}/links/0002/feedback?feature=email`,
			},
		]);
		expect(vm.linkCountLabel).toBe("1 link");
		expect(vm.articles.isEmpty).toBe(false);
	});

	it("keeps the panel non-empty when every link was excluded", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-menu" })],
			linksMeta: { truncated: false },
		});

		expect(vm.articles.isEmpty).toBe(false);
		expect(vm.articles.cards).toHaveLength(0);
		expect(vm.articles.excluded.map((entry) => entry.reasonLabel)).toEqual(["Site navigation"]);
		expect(vm.linkCountLabel).toBeUndefined();
	});

	it("surfaces the feedback confirmation only on the redirect that carries it", () => {
		const confirmed = build({ links: [link()], linksMeta: { truncated: false } });
		expect(confirmed.articles.feedbackNotice).toBe(false);

		const vm = toInboxEmailDetailViewModel({
			entry: entry(),
			activeTab: "articles",
			bodyHtml: undefined,
			links: [link()],
			linksMeta: { truncated: false },
			maxPolls: 300,
			feedbackConfirmed: true,
		});
		expect(vm.articles.feedbackNotice).toBe(true);
	});

	it("labels an excluded link without a recorded reason generically", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: undefined })],
			linksMeta: { truncated: false },
		});

		expect(vm.articles.excluded.map((entry) => entry.reasonLabel)).toEqual(["Not an article"]);
	});

	it("reveals only the first page of cards and offers the rest behind a Show more control", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false } });

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(
			crawledLinks(ARTICLES_PAGE_SIZE).map((entry) => entry.ordinal),
		);
		expect(vm.articles.showMore).toEqual({
			detailHref: `/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles&shown=40`,
			moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?feature=email&shown=40`,
			count: 5,
		});
	});

	it("counts every kept link in the header badge, not just the revealed page", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false } });

		expect(vm.linkCountLabel).toBe("25 links");
		expect(vm.articles.isEmpty).toBe(false);
	});

	it("offers no control when the kept links exactly fill the first page", () => {
		const vm = build({ links: crawledLinks(ARTICLES_PAGE_SIZE), linksMeta: { truncated: false } });

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.showMore).toBeUndefined();
	});

	it("renders the cumulative reveal a no-JS Show more navigation asks for", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false }, shown: 40 });

		expect(vm.articles.cards).toHaveLength(25);
		expect(vm.articles.showMore).toBeUndefined();
	});

	it("pages over the kept links only, leaving excluded ones out of the page budget", () => {
		const vm = build({
			links: [
				link({
					ordinal: formatEmailLinkOrdinal(0),
					status: "skipped",
					skipReason: "list-unsubscribe",
				}),
				...crawledLinks(21, 1),
			],
			linksMeta: { truncated: false },
		});

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.cards[0].ordinal).toBe("0001");
		expect(vm.articles.excluded).toHaveLength(1);
		expect(vm.articles.showMore?.count).toBe(1);
		expect(vm.linkCountLabel).toBe("21 links");
	});
});

describe("toInboxArticlesMoreViewModel", () => {
	function buildMore(input: { links: InboxEmailLinkEntry[]; shown: number }) {
		return toInboxArticlesMoreViewModel({
			links: input.links,
			emailId: SK,
			shown: input.shown,
			maxPolls: 300,
		});
	}

	it("returns only the newly revealed delta, not the cards already on the page", () => {
		const vm = buildMore({ links: crawledLinks(45), shown: 40 });

		expect(vm.cards.map((card) => card.ordinal)).toEqual(
			crawledLinks(ARTICLES_PAGE_SIZE, ARTICLES_PAGE_SIZE).map((entry) => entry.ordinal),
		);
		expect(vm.showMore).toEqual({
			detailHref: `/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles&shown=60`,
			moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?feature=email&shown=60`,
			count: 5,
		});
	});

	it("drops the control once the delta lands on the last card", () => {
		const vm = buildMore({ links: crawledLinks(25), shown: 40 });

		expect(vm.cards.map((card) => card.ordinal)).toEqual(["0020", "0021", "0022", "0023", "0024"]);
		expect(vm.showMore).toBeUndefined();
	});

	it("keeps a still-pending revealed card polling for its preview", () => {
		const vm = buildMore({
			links: [...crawledLinks(ARTICLES_PAGE_SIZE), link({ ordinal: formatEmailLinkOrdinal(20) })],
			shown: 40,
		});

		expect(vm.cards).toHaveLength(1);
		expect(vm.cards[0].cardPollUrl).toContain("/links/0020/card");
	});

	it("never reveals an excluded link as a card", () => {
		const vm = buildMore({
			links: [
				...crawledLinks(ARTICLES_PAGE_SIZE),
				link({ ordinal: formatEmailLinkOrdinal(20), status: "skipped", skipReason: "llm-ad" }),
				...crawledLinks(1, 21),
			],
			shown: 40,
		});

		expect(vm.cards.map((card) => card.ordinal)).toEqual(["0021"]);
	});
});
