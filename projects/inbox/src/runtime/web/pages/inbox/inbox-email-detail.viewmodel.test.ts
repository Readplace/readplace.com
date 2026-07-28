import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailLinksMeta,
	type InboxEmailStatus,
	InboxAddressSchema,
	MessageIdSchema,
	formatEmailLinkOrdinal,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { ARTICLES_PAGE_SIZE } from "./inbox-articles-more.url";
import type { MailTabKey } from "./inbox-email-detail.url";
import {
	type InboxEmailDetailViewModel,
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
		linkCounts: undefined,
		...overrides,
	};
}

function link(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
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

function build(input: {
	entry?: InboxEmailEntry;
	activeTab?: MailTabKey;
	bodyHtml?: string | undefined;
	links?: InboxEmailLinkEntry[];
	linksMeta?: InboxEmailLinksMeta | undefined;
	shown?: number;
	panelPollCount?: number;
}) {
	return toInboxEmailDetailViewModel({
		entry: input.entry ?? entry(),
		activeTab: input.activeTab ?? "view",
		bodyHtml: input.bodyHtml,
		imagesCdnBaseUrl: "https://cdn.test.readplace.com",
		linkData: { source: "rows", links: input.links ?? [], meta: input.linksMeta },
		maxPolls: 300,
		shown: input.shown,
		panelPollCount: input.panelPollCount, linkSaveStates: new Map() });
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
		const vm = build({ activeTab: "articles", linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.activeTab).toBe("articles");
		expect(vm.tabs[1].ariaCurrent).toBe("page");
	});

	it("hands the Skipped tab to the page as the active one", () => {
		const vm = build({ activeTab: "excluded", linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.activeTab).toBe("excluded");
		expect(vm.tabs[2].ariaCurrent).toBe("page");
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
		expect(vm.articles.panelPollUrl).toContain("/articles?poll=1");
		// The header count is held back until extraction writes its barrier.
		expect(vm.linkCountLabel).toBeUndefined();
		// So are the tab counts: "(0)" would read as "none found" rather than
		// "still looking", contradicting the panel's own spinner.
		expect(vm.tabs.map((tab) => tab.label)).toEqual([
			"View",
			"Extracted Articles",
			"Skipped",
		]);
		expect(vm.extractionReported).toBe(false);
	});

	it("keeps the Skipped panel extracting too, so it never claims nothing was skipped early", () => {
		const vm = build({ links: [], linksMeta: undefined });

		// Both panels describe the same extractor run: answering "nothing was
		// skipped" before it has looked is the same lie as "no links found".
		expect(vm.excluded.isExtracting).toBe(true);
		expect(vm.excluded.isStalePending).toBe(false);
		// Its own fragment — polling /articles would swap the Articles panel in here.
		expect(vm.excluded.panelPollUrl).toContain("/excluded?poll=1");
	});

	it("stops polling the instant the dead-letter handler reports extraction gave up", () => {
		const vm = build({ links: [], linksMeta: { truncated: false, extractionFailed: true } });

		// The barrier is present, so nothing is awaiting it — but its zero rows
		// answer a scan that never ran, so the panel must not claim "no links found".
		expect(vm.articles.isExtractionFailed).toBe(true);
		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isStalePending).toBe(false);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.excluded.isExtractionFailed).toBe(true);
		expect(vm.excluded.panelPollUrl).toBeUndefined();
	});

	it("withholds every count for a failed extraction, so no zero is presented as an answer", () => {
		const vm = build({ links: [], linksMeta: { truncated: false, extractionFailed: true } });

		expect(vm.linkCountLabel).toBeUndefined();
		expect(vm.tabs.map((tab) => tab.label)).toEqual(["View", "Extracted Articles", "Skipped"]);
		// An extraction with no counts has no strip worth shipping out of band, so
		// the poll route never tears the tab links out from under the keyboard.
		expect(vm.extractionReported).toBe(false);
	});

	it("keeps a completed extraction reporting normally once the marker is false", () => {
		const vm = build({
			links: crawledLinks(2),
			linksMeta: { truncated: false, extractionFailed: false },
		});

		expect(vm.articles.isExtractionFailed).toBe(false);
		expect(vm.extractionReported).toBe(true);
		expect(vm.linkCountLabel).toBe("2 links");
	});

	it("gives up to a terminal stale state once the budget is spent without a meta barrier", () => {
		const vm = build({ links: [], linksMeta: undefined, panelPollCount: 301 });

		// A pre-feature email, or an extractor that died without reaching its
		// dead-letter queue, never writes a barrier — so the spinner must terminate
		// rather than poll forever.
		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isStalePending).toBe(true);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.excluded.isExtracting).toBe(false);
		expect(vm.excluded.isStalePending).toBe(true);
		expect(vm.excluded.panelPollUrl).toBeUndefined();
		// No trustworthy count while extraction never finished.
		expect(vm.linkCountLabel).toBeUndefined();
	});

	it("stays extracting on the last budgeted poll, before the give-up threshold", () => {
		const vm = build({ links: [], linksMeta: undefined, panelPollCount: 300 });

		expect(vm.articles.isExtracting).toBe(true);
		expect(vm.articles.isStalePending).toBe(false);
		expect(vm.articles.panelPollUrl).toContain("poll=300");
		expect(vm.excluded.isExtracting).toBe(true);
		expect(vm.excluded.panelPollUrl).toContain("poll=300");
	});

	it("never polls a non-received email's panels", () => {
		const vm = build({ entry: entry({ status: "rejected" }), links: [], linksMeta: undefined });

		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.excluded.isExtracting).toBe(false);
		expect(vm.excluded.isEmpty).toBe(true);
		expect(vm.excluded.panelPollUrl).toBeUndefined();
	});

	it("reports a genuinely empty panel once extraction wrote its meta with zero links", () => {
		const vm = build({ links: [], linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.cards).toHaveLength(0);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.articles.truncatedNotice).toBeUndefined();
		// An email with no links at all found none on either tab — neither panel may
		// point at the other for an explanation it doesn't have.
		expect(vm.articles.emptyMessage).toBe("No links found in this email.");
		expect(vm.excluded.isEmpty).toBe(true);
		expect(vm.excluded.emptyMessage).toBe("No links found in this email.");
	});

	it("tells the Skipped panel nothing was skipped when every link was kept", () => {
		const vm = build({ links: [link({ status: "crawled" })], linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.excluded.isEmpty).toBe(true);
		expect(vm.excluded.links).toHaveLength(0);
		// "No links found" would be false here — one was found, and kept.
		expect(vm.excluded.emptyMessage).toBe("Nothing was skipped in this email.");
	});

	it("maps a pending link to a polling card and a crawled link to a terminal card", () => {
		const vm = build({
			linksMeta: { truncated: false, extractionFailed: false },
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
		// The tab counts every kept link, so it agrees with the header badge.
		expect(vm.tabs.map((tab) => tab.label)).toEqual([
			"View",
			"Extracted Articles (2)",
			"Skipped (0)",
		]);
		expect(vm.extractionReported).toBe(true);
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
			linksMeta: { truncated: true, extractionFailed: false },
		});

		expect(vm.articles.cards[0].hasTitle).toBe(false);
		expect(vm.articles.cards[0].cardPollUrl).toBeUndefined();
		expect(vm.articles.truncatedNotice).toBe("Showing the first 1 links found in this email.");
		expect(vm.linkCountLabel).toBe("1+ links");
	});

	it("discloses the extraction cap on both panels, including when every link was skipped", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-ad" })],
			linksMeta: { truncated: true, extractionFailed: false },
		});

		// The cap is a fact about the email, not about one panel: an all-skipped email
		// empties the Articles panel, so a notice that only rode the non-empty branch
		// would disclose the cap on no tab at all.
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.truncatedNotice).toBe("Showing the first 1 links found in this email.");
		expect(vm.excluded.truncatedNotice).toBe("Showing the first 1 links found in this email.");
	});

	it("leaves the cap notice off both panels for an email that was not truncated", () => {
		const vm = build({ links: [link()], linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.articles.truncatedNotice).toBeUndefined();
		expect(vm.excluded.truncatedNotice).toBeUndefined();
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
			linksMeta: { truncated: false, extractionFailed: false },
		});

		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0000"]);
		expect(vm.excluded.isEmpty).toBe(false);
		expect(vm.excluded.links).toEqual([
			{
				ordinal: "0001",
				url: "https://news.example.com/unsub",
				reasonLabel: "Unsubscribe link",
				feedbackAction: `/inbox/${encodeURIComponent(SK)}/links/0001/feedback`,
				buttonId: "inbox-skipped-0001-feedback-include",
			},
			{
				ordinal: "0002",
				url: "https://sponsor.example.com/deal",
				reasonLabel: "Advertisement",
				feedbackAction: `/inbox/${encodeURIComponent(SK)}/links/0002/feedback`,
				buttonId: "inbox-skipped-0002-feedback-include",
			},
		]);
		expect(vm.linkCountLabel).toBe("1 link");
		expect(vm.articles.isEmpty).toBe(false);
	});

	it("empties the Articles panel when every link was skipped, and points at where they went", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-menu" })],
			linksMeta: { truncated: false, extractionFailed: false },
		});

		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.cards).toHaveLength(0);
		// "No links found" would be false: a link was found, then skipped. The empty
		// Articles panel has to point at the tab that holds it.
		expect(vm.articles.emptyMessage).toBe(
			"Every link in this email was skipped — see the Skipped tab.",
		);
		expect(vm.excluded.isEmpty).toBe(false);
		expect(vm.excluded.links.map((entry) => entry.reasonLabel)).toEqual(["Site navigation"]);
		expect(vm.linkCountLabel).toBeUndefined();
	});

	function withConfirmation(
		confirmation: { feedbackConfirmed?: boolean; savedConfirmed?: boolean },
	): InboxEmailDetailViewModel {
		return toInboxEmailDetailViewModel({
			entry: entry(),
			activeTab: "articles",
			bodyHtml: undefined,
			imagesCdnBaseUrl: "https://cdn.test.readplace.com",
			linkData: { source: "rows", links: [link()], meta: { truncated: false, extractionFailed: false } },
			maxPolls: 300,
			...confirmation, linkSaveStates: new Map() });
	}

	it("carries no status toast on a plain page view", () => {
		expect(build({ links: [link()], linksMeta: { truncated: false, extractionFailed: false } }).statusToastMessage)
			.toBeUndefined();
	});

	it("confirms a report as a status toast, so it is seen wherever the reader was scrolled to", () => {
		expect(withConfirmation({ feedbackConfirmed: true }).statusToastMessage).toBe(
			"Thanks — your report was logged.",
		);
	});

	it("confirms a save in the present tense — the route publishes, a subscriber writes the queue", () => {
		expect(withConfirmation({ savedConfirmed: true }).statusToastMessage).toBe(
			"Adding to your queue…",
		);
	});

	it("prefers the save confirmation when a hand-typed URL carries both flags", () => {
		expect(
			withConfirmation({ savedConfirmed: true, feedbackConfirmed: true }).statusToastMessage,
		).toBe("Adding to your queue…");
	});

	it("labels an excluded link without a recorded reason generically", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: undefined })],
			linksMeta: { truncated: false, extractionFailed: false },
		});

		expect(vm.excluded.links.map((entry) => entry.reasonLabel)).toEqual(["Not an article"]);
	});

	it("reveals only the first page of cards and offers the rest behind a Show more control", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(
			crawledLinks(ARTICLES_PAGE_SIZE).map((entry) => entry.ordinal),
		);
		expect(vm.articles.showMore).toEqual({
			detailHref: `/inbox/${encodeURIComponent(SK)}?tab=articles&shown=40`,
			moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?shown=40`,
			count: 5,
		});
	});

	it("counts every kept link in the header badge, not just the revealed page", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.linkCountLabel).toBe("25 links");
		expect(vm.articles.isEmpty).toBe(false);
	});

	it("counts every kept link in the tab too, not the page of cards on screen", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false, extractionFailed: false } });

		// `articles.cards` is one page (20); the tab must report the whole set, or
		// it would disagree with the header badge and with Show more's remainder.
		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.tabs[1].label).toBe("Extracted Articles (25)");
	});

	it("offers no control when the kept links exactly fill the first page", () => {
		const vm = build({ links: crawledLinks(ARTICLES_PAGE_SIZE), linksMeta: { truncated: false, extractionFailed: false } });

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.showMore).toBeUndefined();
	});

	it("renders the cumulative reveal a no-JS Show more navigation asks for", () => {
		const vm = build({ links: crawledLinks(25), linksMeta: { truncated: false, extractionFailed: false }, shown: 40 });

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
			linksMeta: { truncated: false, extractionFailed: false },
		});

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.cards[0].ordinal).toBe("0001");
		expect(vm.excluded.links).toHaveLength(1);
		expect(vm.articles.showMore?.count).toBe(1);
		expect(vm.linkCountLabel).toBe("21 links");
	});
	describe("View tab without link rows", () => {
		function buildFromEntry(entryOverride: InboxEmailEntry) {
			return toInboxEmailDetailViewModel({
				entry: entryOverride,
				activeTab: "view",
				bodyHtml: "<p>hi</p>",
				imagesCdnBaseUrl: "https://cdn.test.readplace.com",
				linkData: { source: "entry" },
				maxPolls: 300, linkSaveStates: new Map() });
		}

		it("derives the header badge and tab counts from the email row's tally", () => {
			const vm = buildFromEntry(
				entry({ linkCounts: { kept: 5, skipped: 2, truncated: false } }),
			);

			expect(vm.linkCountLabel).toBe("5 links");
			expect(vm.tabs.map((tab) => tab.label)).toEqual([
				"View",
				"Extracted Articles (5)",
				"Skipped (2)",
			]);
		});

		it("marks a truncated tally on the badge", () => {
			const vm = buildFromEntry(
				entry({ linkCounts: { kept: 200, skipped: 1, truncated: true } }),
			);

			expect(vm.linkCountLabel).toBe("200+ links");
		});

		it("withholds the badge and tab counts until extraction stamps the tally", () => {
			const vm = buildFromEntry(entry());

			expect(vm.linkCountLabel).toBeUndefined();
			expect(vm.tabs.map((tab) => tab.label)).toEqual([
				"View",
				"Extracted Articles",
				"Skipped",
			]);
		});

		it("shows zero counts for a rejected or unparsed email, which never runs extraction", () => {
			const statuses: InboxEmailStatus[] = ["rejected", "unparsed"];
			for (const status of statuses) {
				const vm = buildFromEntry(entry({ status }));
				expect(vm.linkCountLabel).toBeUndefined();
				expect(vm.tabs.map((tab) => tab.label)).toEqual([
					"View",
					"Extracted Articles (0)",
					"Skipped (0)",
				]);
			}
		});
	});
});

describe("toInboxArticlesMoreViewModel", () => {
	function buildMore(input: { links: InboxEmailLinkEntry[]; shown: number }) {
		return toInboxArticlesMoreViewModel({
			links: input.links,
			emailId: SK,
			shown: input.shown,
			maxPolls: 300, linkSaveStates: new Map() });
	}

	it("returns only the newly revealed delta, not the cards already on the page", () => {
		const vm = buildMore({ links: crawledLinks(45), shown: 40 });

		expect(vm.cards.map((card) => card.ordinal)).toEqual(
			crawledLinks(ARTICLES_PAGE_SIZE, ARTICLES_PAGE_SIZE).map((entry) => entry.ordinal),
		);
		expect(vm.showMore).toEqual({
			detailHref: `/inbox/${encodeURIComponent(SK)}?tab=articles&shown=60`,
			moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?shown=60`,
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
