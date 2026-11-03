import {
	EmailLinkOrdinalSchema,
	formatEmailLinkOrdinal,
	InboxAddressSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	type InboxEmailLinksMeta,
	type InboxEmailStatus,
	type InboxLinkSaveState,
	MessageIdSchema,
} from "@packages/domain/inbox";
import {
	ReadlistFitOverrideIdSchema,
	type ReadlistFitReaderVerdict,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { UserIdSchema } from "@packages/domain/user";
import { ARTICLES_PAGE_SIZE } from "./inbox-articles-more.url";
import type { MailTabKey } from "./inbox-email-detail.url";
import type { InboxEmailFilter } from "./inbox-email-filter";
import {
	type InboxEmailDetailViewModel,
	toInboxArticlesMoreViewModel,
	toInboxEmailDetailViewModel,
} from "./inbox-email-detail.viewmodel";
import type { ReadlistFitOverridesByReadlist } from "./inbox-readlist-fit";

const SK = "2026-06-24T09:00:00.000Z#<m@x>";
const WORK = ReadlistSlugSchema.parse("work");

const TRUNCATED_NOTICE = {
	key: "truncated",
	text: "Showing the first 1 links found in this email.",
	iconName: undefined,
};

const SKIPPED_NOTE = {
	key: "skipped-note",
	text: "These looked like unsubscribe, ad, or menu links — not articles — so they weren't fetched or added.",
	iconName: undefined,
};

const NO_LINKS_EMPTY_STATE = {
	title: "No links found in this email",
	body: undefined,
};

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

function link(
	overrides: Partial<InboxEmailLinkEntry> = {},
): InboxEmailLinkEntry {
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
		anchorText: undefined,
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
	linkSaveStates?: ReadonlyMap<string, InboxLinkSaveState>;
	fitOverrides?: ReadlistFitOverridesByReadlist;
	filter?: InboxEmailFilter;
}) {
	return toInboxEmailDetailViewModel({
		entry: input.entry ?? entry(),
		activeTab: input.activeTab ?? "view",
		bodyHtml: input.bodyHtml,
		imagesCdnBaseUrl: "https://cdn.test.readplace.com",
		linkData: {
			source: "rows",
			links: input.links ?? [],
			meta: input.linksMeta,
		},
		maxPolls: 300,
		shown: input.shown,
		panelPollCount: input.panelPollCount,
		linkSaveStates: input.linkSaveStates ?? new Map(),
		fitOverrides: input.fitOverrides ?? new Map(),
		filter: input.filter,
	});
}

function readerChoice(input: {
	ordinal: string;
	readerVerdict: ReadlistFitReaderVerdict;
	receivedAtMessageId?: string;
}): ReadlistFitOverride {
	return {
		id: ReadlistFitOverrideIdSchema.parse(`0000000000000001-${SK}-${input.ordinal}`),
		url: `https://example.com/kept-${input.ordinal}`,
		anchorText: "A post",
		host: "example.com",
		readerVerdict: input.readerVerdict,
		receivedAtMessageId: input.receivedAtMessageId ?? SK,
		ordinal: EmailLinkOrdinalSchema.parse(input.ordinal),
		createdAt: new Date("2026-10-14T09:00:00.000Z"),
	};
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
		const vm = build({
			entry: entry({ status: "received" }),
			bodyHtml: "<p>hi</p>",
		});

		expect(vm.canRenderBody).toBe(true);
		expect(vm.bodyHtml).toBe("<p>hi</p>");
		expect(vm.activeTab).toBe("view");
		expect(vm.tabs[0].ariaCurrent).toBe("page");
	});

	it("hands the Articles tab to the page as the active one", () => {
		const vm = build({
			activeTab: "articles",
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.activeTab).toBe("articles");
		expect(vm.tabs[1].ariaCurrent).toBe("page");
	});

	it("hands the Skipped tab to the page as the active one", () => {
		const vm = build({
			activeTab: "excluded",
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

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
		const vm = build({
			entry: entry({ status: "received" }),
			bodyHtml: undefined,
		});

		expect(vm.canRenderBody).toBe(false);
		expect(vm.bodyHtml).toBe("");
		expect(vm.unavailableAlert).toEqual({
			title: "Couldn't display this email",
			body: "The original email is preserved.",
		});
	});

	it("never renders the body for a rejected or unparsed email", () => {
		const statuses: InboxEmailStatus[] = ["rejected", "unparsed"];
		for (const status of statuses) {
			const vm = build({
				entry: entry({ status }),
				bodyHtml: "<p>should be ignored</p>",
			});
			expect(vm.canRenderBody).toBe(false);
		}
	});

	it("falls back to placeholders for an empty sender or subject", () => {
		const vm = build({
			entry: entry({ senderEmail: "", subject: "" }),
			bodyHtml: undefined,
		});

		expect(vm.sender).toBe("(unknown sender)");
		expect(vm.subject).toBe("(no subject)");
	});

	it("treats a received email with no meta row as still extracting, not terminally empty", () => {
		const vm = build({ links: [], linksMeta: undefined });

		expect(vm.articles.isExtracting).toBe(true);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.panelPollUrl).toContain("/articles?poll=1");
		expect(vm.articles.notices).toEqual([
			{ key: "extracting", text: "Looking for links…", iconName: "loader" },
		]);
		expect(vm.articles.alerts).toEqual([]);
		expect(vm.articles.listing).toBeUndefined();
		// The tab counts are withheld while extracting: "(0)" would read as "none
		// found" rather than "still looking", contradicting the panel's own spinner.
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
		expect(vm.excluded.notices.map((notice) => notice.key)).toEqual([
			"extracting",
		]);
		expect(vm.excluded.listing).toBeUndefined();
	});

	it("stops polling the instant the dead-letter handler reports extraction gave up", () => {
		const vm = build({
			links: [],
			linksMeta: {
				truncated: false,
				extractionFailed: true,
			},
		});

		// The barrier is present, so nothing is awaiting it — but its zero rows
		// answer a scan that never ran, so the panel must not claim "no links found".
		expect(vm.articles.isExtractionFailed).toBe(true);
		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isStalePending).toBe(false);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.excluded.isExtractionFailed).toBe(true);
		expect(vm.excluded.panelPollUrl).toBeUndefined();
		const failedAlert = {
			key: "failed",
			title: "Couldn't scan this email for links",
			body: "The original message is still on the View tab.",
		};
		expect(vm.articles.alerts).toEqual([failedAlert]);
		expect(vm.articles.notices).toEqual([]);
		expect(vm.articles.listing).toBeUndefined();
		expect(vm.excluded.alerts).toEqual([failedAlert]);
		expect(vm.excluded.listing).toBeUndefined();
	});

	it("withholds every count for a failed extraction, so no zero is presented as an answer", () => {
		const vm = build({
			links: [],
			linksMeta: {
				truncated: false,
				extractionFailed: true,
			},
		});

		expect(vm.tabs.map((tab) => tab.label)).toEqual([
			"View",
			"Extracted Articles",
			"Skipped",
		]);
		// An extraction with no counts has no strip worth shipping out of band, so
		// the poll route never tears the tab links out from under the keyboard.
		expect(vm.extractionReported).toBe(false);
	});

	it("keeps a completed extraction reporting normally once the marker is false", () => {
		const vm = build({
			links: crawledLinks(2),
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.isExtractionFailed).toBe(false);
		expect(vm.extractionReported).toBe(true);
		expect(vm.tabs[1].label).toBe("Extracted Articles (2)");
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
		const staleAlert = {
			key: "stale",
			title: "Couldn't scan this email for links",
			body: "The original message is still on the View tab.",
		};
		expect(vm.articles.alerts).toEqual([staleAlert]);
		expect(vm.articles.listing).toBeUndefined();
		expect(vm.excluded.alerts).toEqual([staleAlert]);
		expect(vm.excluded.listing).toBeUndefined();
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
		const vm = build({
			entry: entry({ status: "rejected" }),
			links: [],
			linksMeta: undefined,
		});

		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.excluded.isExtracting).toBe(false);
		expect(vm.excluded.isEmpty).toBe(true);
		expect(vm.excluded.panelPollUrl).toBeUndefined();
	});

	it("reports a genuinely empty panel once extraction wrote its meta with zero links", () => {
		const vm = build({
			links: [],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.isExtracting).toBe(false);
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.cards).toHaveLength(0);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.articles.notices).toEqual([]);
		expect(vm.articles.alerts).toEqual([]);
		// An email with no links at all found none on either tab — neither panel may
		// point at the other for an explanation it doesn't have.
		expect(vm.articles.listing).toEqual({
			countLabel: "0 Extracted Articles",
			emptyStates: [NO_LINKS_EMPTY_STATE],
		});
		expect(vm.excluded.isEmpty).toBe(true);
		expect(vm.excluded.notices).toEqual([]);
		expect(vm.excluded.listing).toEqual({
			countLabel: "0 Skipped",
			emptyStates: [NO_LINKS_EMPTY_STATE],
		});
	});

	it("tells the Skipped panel nothing was skipped when every link was kept", () => {
		const vm = build({
			links: [link({ status: "crawled" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.excluded.isEmpty).toBe(true);
		expect(vm.excluded.links).toHaveLength(0);
		// "No links found" would be false here — one was found, and kept.
		expect(vm.excluded.listing?.emptyStates).toEqual([
			{ title: "Nothing was skipped in this email", body: undefined },
		]);
		expect(vm.articles.listing).toEqual({
			countLabel: "1 Extracted Article",
			emptyStates: [],
		});
	});

	it("maps a pending link to a polling card and a crawled link to a terminal card", () => {
		const vm = build({
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
			links: [
				link({
					ordinal: EmailLinkOrdinalSchema.parse("0000"),
					status: "pending",
				}),
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
		// The tab reports every kept link, not the page of cards on screen.
		expect(vm.tabs.map((tab) => tab.label)).toEqual([
			"View",
			"Extracted Articles (2)",
			"Skipped (0)",
		]);
		expect(vm.extractionReported).toBe(true);
		expect(vm.articles.listing).toEqual({
			countLabel: "2 Extracted Articles",
			emptyStates: [],
		});
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
			linksMeta: {
				truncated: true,
				extractionFailed: false,
			},
		});

		expect(vm.articles.cards[0].hasTitle).toBe(false);
		expect(vm.articles.cards[0].cardPollUrl).toBeUndefined();
		expect(vm.articles.notices).toEqual([TRUNCATED_NOTICE]);
	});

	it("discloses the extraction cap on both panels, including when every link was skipped", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-ad" })],
			linksMeta: {
				truncated: true,
				extractionFailed: false,
			},
		});

		// The cap is a fact about the email, not about one panel: an all-skipped email
		// empties the Articles panel, so a notice that only rode the non-empty branch
		// would disclose the cap on no tab at all.
		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.notices).toEqual([TRUNCATED_NOTICE]);
		expect(vm.excluded.notices).toEqual([TRUNCATED_NOTICE, SKIPPED_NOTE]);
	});

	it("leaves the cap notice off both panels for an email that was not truncated", () => {
		const vm = build({
			links: [link()],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.notices).toEqual([]);
		expect(vm.excluded.notices).toEqual([]);
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
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0000"]);
		expect(vm.excluded.isEmpty).toBe(false);
		expect(vm.excluded.listing).toEqual({
			countLabel: "2 Skipped",
			emptyStates: [],
		});
		expect(vm.excluded.notices).toEqual([SKIPPED_NOTE]);
		expect(vm.excluded.links).toEqual([
			{
				ordinal: "0001",
				url: "https://news.example.com/unsub",
				reasonLabel: "Unsubscribe link",
				domId: "inbox-skipped-0001",
				actions: [
					{
						key: "save",
						label: "Save to All",
						ariaLabel: "Save to All: https://news.example.com/unsub",
						saveState: "unsaved",
						iconName: undefined,
						buttonId: "inbox-skipped-0001-save",
						href: `/inbox/${encodeURIComponent(SK)}/links/0001/save?utm_source=inbox-excluded-link&utm_medium=internal&utm_content=save-link`,
						method: "POST",
						inPlaceTargetId: "inbox-skipped-0001",
					},
				],
				pollUrl: undefined,
			},
			{
				ordinal: "0002",
				url: "https://sponsor.example.com/deal",
				reasonLabel: "Advertisement",
				domId: "inbox-skipped-0002",
				actions: [
					{
						key: "save",
						label: "Save to All",
						ariaLabel: "Save to All: https://sponsor.example.com/deal",
						saveState: "unsaved",
						iconName: undefined,
						buttonId: "inbox-skipped-0002-save",
						href: `/inbox/${encodeURIComponent(SK)}/links/0002/save?utm_source=inbox-excluded-link&utm_medium=internal&utm_content=save-link`,
						method: "POST",
						inPlaceTargetId: "inbox-skipped-0002",
					},
				],
				pollUrl: undefined,
			},
		]);
		expect(vm.articles.isEmpty).toBe(false);
	});

	it("empties the Articles panel when every link was skipped, and points at where they went", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-menu" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.isEmpty).toBe(true);
		expect(vm.articles.cards).toHaveLength(0);
		// "No links found" would be false: a link was found, then skipped. The empty
		// Articles panel has to point at the tab that holds it.
		expect(vm.articles.listing?.emptyStates).toEqual([
			{
				title: "Every link in this email was skipped",
				body: "See the Skipped tab.",
			},
		]);
		expect(vm.excluded.isEmpty).toBe(false);
		expect(vm.excluded.links.map((entry) => entry.reasonLabel)).toEqual([
			"Site navigation",
		]);
	});

	function withConfirmation(confirmation: {
		feedbackConfirmed?: boolean;
		savedConfirmed?: boolean;
	}): InboxEmailDetailViewModel {
		return toInboxEmailDetailViewModel({
			entry: entry(),
			activeTab: "articles",
			bodyHtml: undefined,
			imagesCdnBaseUrl: "https://cdn.test.readplace.com",
			linkData: {
				source: "rows",
				links: [link()],
				meta: {
					truncated: false,
					extractionFailed: false,
				},
			},
			maxPolls: 300,
			...confirmation,
			linkSaveStates: new Map(),
			fitOverrides: new Map(),
		});
	}

	it("carries no status toast on a plain page view", () => {
		expect(
			build({
				links: [link()],
				linksMeta: {
					truncated: false,
					extractionFailed: false,
				},
			}).statusToast,
		).toBeUndefined();
	});

	it("confirms a report as a status toast, so it is seen wherever the reader was scrolled to", () => {
		expect(
			withConfirmation({ feedbackConfirmed: true }).statusToast,
		).toEqual({ message: "Thanks — your report was logged", undo: undefined });
	});

	it("confirms a save in the present tense — the route publishes, a subscriber writes the queue", () => {
		expect(withConfirmation({ savedConfirmed: true }).statusToast).toEqual({
			message: "Adding to All…",
			undo: undefined,
		});
	});

	it("prefers the save confirmation when a hand-typed URL carries both flags", () => {
		expect(
			withConfirmation({ savedConfirmed: true, feedbackConfirmed: true })
				.statusToast?.message,
		).toBe("Adding to All…");
	});

	it("labels an excluded link without a recorded reason generically", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: undefined })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.excluded.links.map((entry) => entry.reasonLabel)).toEqual([
			"Not an article",
		]);
	});

	it("offers a save action on a saveable skipped link, so a misclassification is one click to fix", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-ad" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.excluded.links[0].actions.map((action) => action.href)).toEqual([
			`/inbox/${encodeURIComponent(SK)}/links/0000/save?utm_source=inbox-excluded-link&utm_medium=internal&utm_content=save-link`,
		]);
	});

	it("shows a skipped link the reader already saved as saved, and still saveable", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-ad" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
			linkSaveStates: new Map([["https://example.com/post", "saved"]]),
		});

		expect(vm.excluded.links[0].actions).toEqual([
			expect.objectContaining({
				label: "Save again",
				ariaLabel: "Saved to All \u2014 save again: https://example.com/post",
				saveState: "saved",
				iconName: "check",
				href: `/inbox/${encodeURIComponent(SK)}/links/0000/save?utm_source=inbox-excluded-link&utm_medium=internal&utm_content=save-link`,
			}),
		]);
	});

	it("shows a skipped link with no recorded save as unsaved", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-ad" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.excluded.links[0].actions).toEqual([
			expect.objectContaining({
				label: "Save to All",
				ariaLabel: "Save to All: https://example.com/post",
				saveState: "unsaved",
				iconName: undefined,
			}),
		]);
	});

	it("shows a skipped link whose save failed as unsaved, so the reader can try again", () => {
		const vm = build({
			links: [link({ status: "skipped", skipReason: "llm-ad" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
			linkSaveStates: new Map([["https://example.com/post", "failed"]]),
		});

		expect(
			vm.excluded.links[0].actions.map((action) => [
				action.saveState,
				action.label,
			]),
		).toEqual([["unsaved", "Save to All"]]);
	});

	it("withholds the save action from a skipped link whose URL is unsaveable", () => {
		const vm = build({
			links: [
				link({
					status: "skipped",
					skipReason: "list-unsubscribe",
					url: "https://localhost/private",
				}),
			],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.excluded.links[0].actions).toEqual([]);
	});

	it("reveals only the first page of cards and offers the rest behind a Show more control", () => {
		const vm = build({
			links: crawledLinks(25),
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(
			crawledLinks(ARTICLES_PAGE_SIZE).map((entry) => entry.ordinal),
		);
		expect(vm.articles.showMore).toEqual({
			detailHref: `/inbox/${encodeURIComponent(SK)}?tab=articles&shown=40&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
			moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?shown=40&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
			count: 5,
		});
	});

	it("counts every kept link in the tab, not the page of cards on screen", () => {
		const vm = build({
			links: crawledLinks(25),
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		// `articles.cards` is one page (20); the tab must report the whole set, or
		// it would disagree with Show more's remainder.
		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.tabs[1].label).toBe("Extracted Articles (25)");
	});

	it("offers no control when the kept links exactly fill the first page", () => {
		const vm = build({
			links: crawledLinks(ARTICLES_PAGE_SIZE),
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.showMore).toBeUndefined();
	});

	it("renders the cumulative reveal a no-JS Show more navigation asks for", () => {
		const vm = build({
			links: crawledLinks(25),
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
			shown: 40,
		});

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
			linksMeta: {
				truncated: false,
				extractionFailed: false,
			},
		});

		expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
		expect(vm.articles.cards[0].ordinal).toBe("0001");
		expect(vm.excluded.links).toHaveLength(1);
		expect(vm.articles.showMore?.count).toBe(1);
	});
	describe("View tab without link rows", () => {
		function buildFromEntry(entryOverride: InboxEmailEntry) {
			return toInboxEmailDetailViewModel({
				entry: entryOverride,
				activeTab: "view",
				bodyHtml: "<p>hi</p>",
				imagesCdnBaseUrl: "https://cdn.test.readplace.com",
				linkData: { source: "entry" },
				maxPolls: 300,
				linkSaveStates: new Map(),
				fitOverrides: new Map(),
			});
		}

		it("derives the tab counts from the email row's tally", () => {
			const vm = buildFromEntry(
				entry({ linkCounts: { kept: 5, skipped: 2, truncated: false } }),
			);

			expect(vm.tabs.map((tab) => tab.label)).toEqual([
				"View",
				"Extracted Articles (5)",
				"Skipped (2)",
			]);
		});

		it("withholds the tab counts until extraction stamps the tally", () => {
			const vm = buildFromEntry(entry());

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
	function buildMore(input: {
		links: InboxEmailLinkEntry[];
		shown: number;
		meta?: InboxEmailLinksMeta;
		filter?: InboxEmailFilter;
	}) {
		return toInboxArticlesMoreViewModel({
			links: input.links,
			meta: input.meta,
			emailId: SK,
			shown: input.shown,
			maxPolls: 300,
			linkSaveStates: new Map(),
			fitOverrides: new Map(),
			filter: input.filter,
		});
	}

	it("returns only the newly revealed delta, not the cards already on the page", () => {
		const vm = buildMore({ links: crawledLinks(45), shown: 40 });

		expect(vm.cards.map((card) => card.ordinal)).toEqual(
			crawledLinks(ARTICLES_PAGE_SIZE, ARTICLES_PAGE_SIZE).map(
				(entry) => entry.ordinal,
			),
		);
		expect(vm.showMore).toEqual({
			detailHref: `/inbox/${encodeURIComponent(SK)}?tab=articles&shown=60&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
			moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?shown=60&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
			count: 5,
		});
	});

	it("drops the control once the delta lands on the last card", () => {
		const vm = buildMore({ links: crawledLinks(25), shown: 40 });

		expect(vm.cards.map((card) => card.ordinal)).toEqual([
			"0020",
			"0021",
			"0022",
			"0023",
			"0024",
		]);
		expect(vm.showMore).toBeUndefined();
	});

	it("keeps a still-pending revealed card polling for its preview", () => {
		const vm = buildMore({
			links: [
				...crawledLinks(ARTICLES_PAGE_SIZE),
				link({ ordinal: formatEmailLinkOrdinal(20) }),
			],
			shown: 40,
		});

		expect(vm.cards).toHaveLength(1);
		expect(vm.cards[0].cardPollUrl).toContain("/links/0020/card");
	});

	it("never reveals an excluded link as a card", () => {
		const vm = buildMore({
			links: [
				...crawledLinks(ARTICLES_PAGE_SIZE),
				link({
					ordinal: formatEmailLinkOrdinal(20),
					status: "skipped",
					skipReason: "llm-ad",
				}),
				...crawledLinks(1, 21),
			],
			shown: 40,
		});

		expect(vm.cards.map((card) => card.ordinal)).toEqual(["0021"]);
	});

});


describe("toInboxEmailDetailViewModel for an inbox routed to a readlist", () => {
	const SAVED_TO_ALL = { key: "decided", text: "Saved to All.", iconName: undefined };
	const FAILED_WORK_LINE =
		"Couldn't choose articles for Work. Everything stays in All. Use Keep in Work on any article you want there.";

	function kept(ordinal: string): InboxEmailLinkEntry {
		return link({
			ordinal: EmailLinkOrdinalSchema.parse(ordinal),
			url: `https://example.com/kept-${ordinal}`,
			status: "crawled",
			title: `Kept ${ordinal}`,
		});
	}

	function fitEntry(ordinal: string, verdict: "keep" | "drop" | "unsure") {
		return { ordinal: EmailLinkOrdinalSchema.parse(ordinal), verdict, reason: `Reason ${ordinal}` };
	}

	function routedMeta(input: {
		eligibleArticleCount: number;
		readlistOutcomes?: InboxEmailLinksMeta["readlistOutcomes"];
	}): InboxEmailLinksMeta {
		return {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: WORK, label: "Work" }],
			eligibleArticleCount: input.eligibleArticleCount,
			savesHeld: false,
			readlistOutcomes: input.readlistOutcomes,
		};
	}

	function decided(fitEntries: ReturnType<typeof fitEntry>[]): InboxEmailLinksMeta {
		return routedMeta({
			eligibleArticleCount: fitEntries.length,
			readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "filtered", fit: fitEntries }],
		});
	}

	function lineTexts(vm: InboxEmailDetailViewModel): string[] {
		return vm.articles.readlistLines.map(({ text }) => text);
	}

	it("says every article went to All and keeps polling while the readlist chooses, with counts shown", () => {
		const vm = build({
			links: [kept("0000"), kept("0001")],
			linksMeta: routedMeta({ eligibleArticleCount: 2 }),
		});

		expect(vm.articles.notices).toEqual([
			SAVED_TO_ALL,
			{ key: "deciding", text: "Choosing articles for Work…", iconName: "loader" },
		]);
		expect(vm.articles.readlistLines).toEqual([]);
		expect(vm.articles.alerts).toEqual([]);
		expect(vm.articles.panelPollUrl).toContain("/articles?poll=1");
		expect(vm.tabs.map((tab) => tab.label)).toEqual([
			"View",
			"Extracted Articles (2)",
			"Skipped (0)",
		]);
		expect(vm.extractionReported).toBe(true);
	});

	it("says it is still choosing once the poll budget is spent", () => {
		const vm = build({
			links: [kept("0000")],
			linksMeta: routedMeta({ eligibleArticleCount: 1 }),
			panelPollCount: 301,
		});

		expect(vm.articles.notices).toEqual([
			SAVED_TO_ALL,
			{
				key: "deciding",
				text: "Still choosing articles for Work. Reload later to see the result.",
				iconName: undefined,
			},
		]);
		expect(vm.articles.panelPollUrl).toBeUndefined();
	});

	it("ends on a readlist line with both filters when some articles fit", () => {
		const vm = build({
			links: [kept("0000"), kept("0001"), kept("0002")],
			linksMeta: decided([fitEntry("0000", "keep"), fitEntry("0001", "drop"), fitEntry("0002", "drop")]),
		});

		expect(vm.articles.notices).toEqual([SAVED_TO_ALL]);
		expect(vm.articles.readlistLines).toEqual([
			{
				readlist: WORK,
				elementId: "inbox-readlist-line-work",
				text: "1 of 3 also fit Work.",
				filters: [
					{
						show: "fit",
						text: "Show the 1 that fit",
						href: `/inbox/${encodeURIComponent(SK)}?tab=articles&readlist=work&show=fit&utm_source=inbox-email-detail&utm_medium=internal&utm_content=readlist-filter-fit`,
						current: false,
					},
					{
						show: "rest",
						text: "Show the 2 that didn't",
						href: `/inbox/${encodeURIComponent(SK)}?tab=articles&readlist=work&show=rest&utm_source=inbox-email-detail&utm_medium=internal&utm_content=readlist-filter-rest`,
						current: false,
					},
				],
			},
		]);
		expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0000", "0001", "0002"]);
		expect(vm.articles.panelPollUrl).toBeUndefined();
	});

	it("says all fit, with no filter, when every article fits", () => {
		const vm = build({
			links: [kept("0000"), kept("0001")],
			linksMeta: decided([fitEntry("0000", "keep"), fitEntry("0001", "keep")]),
		});

		expect(vm.articles.readlistLines).toEqual([
			{ readlist: WORK, elementId: "inbox-readlist-line-work", text: "All 2 also fit Work.", filters: [] },
		]);
	});

	it("says nothing fit, with no filter, when no article fits", () => {
		const vm = build({
			links: [kept("0000"), kept("0001")],
			linksMeta: decided([fitEntry("0000", "drop"), fitEntry("0001", "drop")]),
		});

		expect(lineTexts(vm)).toEqual(["Nothing in this issue fit Work."]);
		expect(vm.articles.readlistLines[0].filters).toEqual([]);
	});

	it("counts an unsure article and one with no verdict as not fitting", () => {
		const vm = build({
			links: [kept("0000"), kept("0001"), kept("0002")],
			linksMeta: decided([fitEntry("0000", "keep"), fitEntry("0001", "unsure")]),
		});

		expect(lineTexts(vm)).toEqual(["1 of 3 also fit Work."]);
	});

	it("counts the reader's choices over the engine's", () => {
		const vm = build({
			links: [kept("0000"), kept("0001"), kept("0002")],
			linksMeta: decided([fitEntry("0000", "keep"), fitEntry("0001", "drop"), fitEntry("0002", "drop")]),
			fitOverrides: new Map([
				[
					WORK,
					[
						readerChoice({ ordinal: "0000", readerVerdict: "drop" }),
						readerChoice({ ordinal: "0001", readerVerdict: "keep" }),
						readerChoice({ ordinal: "0002", readerVerdict: "keep" }),
					],
				],
			]),
		});

		expect(lineTexts(vm)).toEqual(["2 of 3 also fit Work."]);
	});

	it("takes the newest choice for an article and ignores choices made in another email", () => {
		const vm = build({
			links: [kept("0000"), kept("0001")],
			linksMeta: decided([fitEntry("0000", "drop"), fitEntry("0001", "drop")]),
			fitOverrides: new Map([
				[
					WORK,
					[
						readerChoice({ ordinal: "0001", readerVerdict: "keep", receivedAtMessageId: "2026-06-25T09:00:00.000Z#<other@x>" }),
						readerChoice({ ordinal: "0000", readerVerdict: "keep" }),
						readerChoice({ ordinal: "0000", readerVerdict: "drop" }),
					],
				],
			]),
		});

		expect(lineTexts(vm)).toEqual(["1 of 2 also fit Work."]);
	});

	it("says the readlist could not choose, and points at Keep, when its decision failed", () => {
		const vm = build({
			links: [kept("0000")],
			linksMeta: routedMeta({
				eligibleArticleCount: 1,
				readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "failed", fit: [] }],
			}),
		});

		expect(vm.articles.alerts).toEqual([]);
		expect(vm.articles.notices).toEqual([SAVED_TO_ALL]);
		expect(vm.articles.readlistLines).toEqual([
			{ readlist: WORK, elementId: "inbox-readlist-line-work", text: FAILED_WORK_LINE, filters: [] },
		]);
	});

	it("names a failed readlist by the label in the destination snapshot", () => {
		const vm = build({
			links: [kept("0000")],
			linksMeta: {
				...routedMeta({
					eligibleArticleCount: 1,
					readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "failed", fit: [] }],
				}),
				selectedReadlists: [{ readlist: WORK, label: "Day job" }],
			},
		});

		expect(lineTexts(vm)).toEqual([
			"Couldn't choose articles for Day job. Everything stays in All. Use Keep in Day job on any article you want there.",
		]);
	});

	it("keeps the count line, and adds no readlist line, when the readlist has no purpose", () => {
		const vm = build({
			links: [kept("0000"), kept("0001")],
			linksMeta: routedMeta({
				eligibleArticleCount: 2,
				readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "no-purpose", fit: [] }],
			}),
		});

		expect(vm.articles.notices).toEqual([
			SAVED_TO_ALL,
			{ key: "decided", text: "2 articles saved to Work; 0 didn't fit.", iconName: undefined },
		]);
		expect(vm.articles.readlistLines).toEqual([]);
	});

	it("counts no-purpose drops on the count line, with the singular for one article", () => {
		const vm = build({
			links: [kept("0000"), kept("0001")],
			linksMeta: routedMeta({
				eligibleArticleCount: 2,
				readlistOutcomes: [
					{ readlist: WORK, readlistLabel: "Work", decision: "no-purpose", fit: [fitEntry("0001", "drop")] },
				],
			}),
		});

		expect(vm.articles.notices.map(({ text }) => text)).toEqual([
			"Saved to All.",
			"1 article saved to Work; 1 didn't fit.",
		]);
	});

	it("says nothing about a readlist that no longer exists", () => {
		const vm = build({
			links: [kept("0000")],
			linksMeta: routedMeta({
				eligibleArticleCount: 1,
				readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "readlist-missing", fit: [] }],
			}),
		});

		expect(vm.articles.notices).toEqual([SAVED_TO_ALL]);
		expect(vm.articles.readlistLines).toEqual([]);
	});

	it("ends a routed email with no eligible link on its readlist line", () => {
		const vm = build({
			links: [],
			linksMeta: decided([]),
		});

		expect(vm.articles.notices).toEqual([]);
		expect(lineTexts(vm)).toEqual(["Nothing in this issue fit Work."]);
		expect(vm.articles.panelPollUrl).toBeUndefined();
	});

	describe("filtering by a readlist's call", () => {
		const SOME_FIT = decided([fitEntry("0000", "keep"), fitEntry("0001", "drop"), fitEntry("0002", "keep")]);
		const SOME_FIT_LINKS = [kept("0000"), kept("0001"), kept("0002")];

		it("shows only the articles that fit, and marks that filter current", () => {
			const vm = build({
				links: SOME_FIT_LINKS,
				linksMeta: SOME_FIT,
				filter: { readlist: WORK, show: "fit" },
			});

			expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0000", "0002"]);
			expect(vm.articles.readlistLines[0].filters.map(({ show, current }) => ({ show, current }))).toEqual([
				{ show: "fit", current: true },
				{ show: "rest", current: false },
			]);
			expect(vm.tabs.map((tab) => tab.label)).toContain("Extracted Articles (3)");
		});

		it("shows only the articles that didn't fit, counting the reader's choices", () => {
			const vm = build({
				links: SOME_FIT_LINKS,
				linksMeta: SOME_FIT,
				fitOverrides: new Map([[WORK, [readerChoice({ ordinal: "0002", readerVerdict: "drop" })]]]),
				filter: { readlist: WORK, show: "rest" },
			});

			expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0001", "0002"]);
			expect(vm.articles.readlistLines[0].filters.map(({ current }) => current)).toEqual([false, true]);
		});

		it("filters before paging, so Show more carries the filter and counts the filtered articles", () => {
			const links = crawledLinks(25);
			const vm = build({
				links,
				linksMeta: decided(links.map(({ ordinal }) => fitEntry(ordinal, ordinal === "0003" ? "drop" : "keep"))),
				filter: { readlist: WORK, show: "fit" },
			});

			expect(vm.articles.cards).toHaveLength(ARTICLES_PAGE_SIZE);
			expect(vm.articles.cards.map((card) => card.ordinal)).not.toContain("0003");
			expect(vm.articles.showMore).toEqual({
				detailHref: `/inbox/${encodeURIComponent(SK)}?tab=articles&shown=40&readlist=work&show=fit&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
				moreUrl: `/inbox/${encodeURIComponent(SK)}/articles/more?shown=40&readlist=work&show=fit&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
				count: 4,
			});
		});

		it("keeps the filter on the panel poll while another readlist is still choosing", () => {
			const science = ReadlistSlugSchema.parse("science");
			const vm = build({
				links: SOME_FIT_LINKS,
				linksMeta: {
					...SOME_FIT,
					selectedReadlists: [
						{ readlist: WORK, label: "Work" },
						{ readlist: science, label: "Science" },
					],
				},
				filter: { readlist: WORK, show: "fit" },
			});

			expect(vm.articles.panelPollUrl).toBe(
				`/inbox/${encodeURIComponent(SK)}/articles?poll=1&readlist=work&show=fit`,
			);
		});

		it.each([
			{
				name: "a readlist the email was not routed to",
				meta: SOME_FIT,
				filter: { readlist: ReadlistSlugSchema.parse("science"), show: "fit" as const },
			},
			{
				name: "a readlist that has not decided",
				meta: routedMeta({ eligibleArticleCount: 3 }),
				filter: { readlist: WORK, show: "fit" as const },
			},
			{
				name: "a readlist whose decision failed",
				meta: routedMeta({
					eligibleArticleCount: 3,
					readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "failed", fit: [] }],
				}),
				filter: { readlist: WORK, show: "fit" as const },
			},
			{
				name: "a filter that matches no article",
				meta: decided([fitEntry("0000", "keep"), fitEntry("0001", "keep"), fitEntry("0002", "keep")]),
				filter: { readlist: WORK, show: "rest" as const },
			},
		])("ignores a filter on $name", ({ meta, filter }) => {
			const vm = build({ links: SOME_FIT_LINKS, linksMeta: meta, filter });

			expect(vm.articles.cards.map((card) => card.ordinal)).toEqual(["0000", "0001", "0002"]);
			expect(vm.articles.readlistLines.flatMap(({ filters }) => filters).some(({ current }) => current)).toBe(false);
		});

		it("reveals the next page of filtered articles, keeping the filter on Show more", () => {
			const links = crawledLinks(45);
			const vm = toInboxArticlesMoreViewModel({
				links,
				meta: decided(links.map(({ ordinal }) => fitEntry(ordinal, ordinal === "0003" ? "drop" : "keep"))),
				emailId: SK,
				shown: 40,
				maxPolls: 300,
				linkSaveStates: new Map(),
				fitOverrides: new Map(),
				filter: { readlist: WORK, show: "fit" },
			});

			expect(vm.cards.map((card) => card.ordinal)).toEqual(
				crawledLinks(ARTICLES_PAGE_SIZE, 21).map(({ ordinal }) => ordinal),
			);
			expect(vm.showMore?.moreUrl).toBe(
				`/inbox/${encodeURIComponent(SK)}/articles/more?shown=60&readlist=work&show=fit&utm_source=inbox-email-detail&utm_medium=internal&utm_content=show-more-articles`,
			);
			expect(vm.showMore?.count).toBe(4);
		});
	});
});

describe("Gmail filtering results", () => {
	it("shows All articles while independent custom lists are choosing, rejecting, and failing", () => {
		const science = ReadlistSlugSchema.parse("science");
		const pending = ReadlistSlugSchema.parse("pending");
		const vm = build({
			links: [link({ status: "crawled" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
				selectedReadlists: [
					{ readlist: WORK, label: "Work" },
					{ readlist: science, label: "Science" },
					{ readlist: pending, label: "Pending" },
				],
				readlistOutcomes: [
					{
						readlist: WORK,
						readlistLabel: "Work",
						decision: "filtered",
						fit: [
							{
								ordinal: EmailLinkOrdinalSchema.parse("0000"),
								verdict: "drop",
								reason: "Outside this list",
							},
						],
					},
					{
						readlist: science,
						readlistLabel: "Science",
						decision: "failed",
						fit: [],
					},
				],
			},
		});
		expect(vm.articles.cards.map(({ ordinal }) => ordinal)).toEqual(["0000"]);
		expect(vm.articles.listing).toEqual({
			countLabel: "1 Extracted Article",
			emptyStates: [],
		});
		expect(vm.articles.notices.map(({ text }) => text)).toEqual([
			"Saved to All.",
			"Choosing articles for Pending…",
		]);
		expect(vm.articles.readlistLines.map(({ text }) => text)).toEqual([
			"Nothing in this issue fit Work.",
			"Couldn't choose articles for Science. Everything stays in All. Use Keep in Science on any article you want there.",
		]);
		expect(vm.articles.panelPollUrl).toContain("poll=1");
		expect(vm.tabs.map(({ label }) => label)).toEqual([
			"View",
			"Extracted Articles (1)",
			"Skipped (0)",
		]);
	});
});

it("finishes Gmail All-only extraction without a custom filtering spinner", () => {
	const vm = build({
		links: [],
		linksMeta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [],
		},
	});
	expect(vm.articles.notices).toEqual([]);
	expect(vm.articles.panelPollUrl).toBeUndefined();
});

it("stops polling an unfinished Gmail custom list while the All articles remain visible", () => {
	const vm = build({
		links: [link({ status: "crawled" })],
		panelPollCount: 301,
		linksMeta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: WORK, label: "Work" }],
		},
	});
	expect(vm.articles.notices.map(({ text }) => text)).toEqual([
		"Saved to All.",
		"Still choosing articles for Work. Reload later to see the result.",
	]);
	expect(vm.articles.panelPollUrl).toBeUndefined();
});

it("reports one accepted Gmail article using the readlist's captured name", () => {
	const vm = build({
		links: [link({ status: "crawled" })],
		linksMeta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: WORK, label: "Day job" }],
			readlistOutcomes: [
				{
					readlist: WORK,
					readlistLabel: "Work",
					decision: "filtered",
					fit: [{ ordinal: EmailLinkOrdinalSchema.parse("0000"), verdict: "keep", reason: "On topic" }],
				},
			],
		},
	});
	expect(vm.articles.notices.map(({ text }) => text)).toEqual(["Saved to All."]);
	expect(vm.articles.readlistLines.map(({ text }) => text)).toEqual(["All 1 also fit Day job."]);
	expect(vm.articles.panelPollUrl).toBeUndefined();
});

it("claims no save to All when the stored count says no Gmail article was eligible", () => {
	const vm = build({ links: [link({ status: "crawled" })], linksMeta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }], eligibleArticleCount: 0, savesHeld: false, readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "filtered", fit: [] }] } });
	expect(vm.articles.notices).toEqual([]);
	expect(vm.articles.readlistLines.map(({ text }) => text)).toEqual(["Nothing in this issue fit Work."]);
	expect(vm.articles.panelPollUrl).toBeUndefined();
});

it("shows held Gmail selections without claiming saves or waiting for custom outcomes", () => {
	const vm = build({ links: [link({ status: "crawled" })], linksMeta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }], eligibleArticleCount: 1, savesHeld: true } });
	expect(vm.articles.notices.map(({ text }) => text)).toEqual(["No articles were saved to Work because this account is read-only."]);
	expect(vm.articles.readlistLines).toEqual([]);
	expect(vm.articles.panelPollUrl).toBeUndefined();
});

it("keeps the read-only line, with no readlist line or filter, when a held email carries an outcome", () => {
	const vm = build({
		links: [link({ status: "crawled" }), link({ ordinal: EmailLinkOrdinalSchema.parse("0001"), status: "crawled" })],
		linksMeta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: WORK, label: "Work" }],
			eligibleArticleCount: 2,
			savesHeld: true,
			readlistOutcomes: [
				{
					readlist: WORK,
					readlistLabel: "Work",
					decision: "filtered",
					fit: [{ ordinal: EmailLinkOrdinalSchema.parse("0000"), verdict: "keep", reason: "On topic" }],
				},
			],
		},
		filter: { readlist: WORK, show: "fit" },
	});
	expect(vm.articles.notices.map(({ text }) => text)).toEqual(["No articles were saved to Work because this account is read-only."]);
	expect(vm.articles.readlistLines).toEqual([]);
	expect(vm.articles.cards).toHaveLength(2);
});

describe("a Gmail newsletter kept as an issue", () => {
	it("says the issue went to All when its mapping has no custom readlist", () => {
		const vm = build({
			links: [link({ status: "crawled" })],
			linksMeta: { truncated: false, extractionFailed: false, issueSave: { readlists: [], held: false } },
		});
		expect(vm.articles.notices.map(({ text }) => text)).toEqual(["Saved this issue to All."]);
		expect(vm.articles.readlistLines).toEqual([]);
		expect(vm.articles.panelPollUrl).toBeUndefined();
		expect(vm.articles.cards.map((card) => card.actions.map((action) => action.key))).toEqual([["save"]]);
	});

	it("names every readlist the issue was filed into, with no readlist line", () => {
		const science = ReadlistSlugSchema.parse("science");
		const vm = build({
			links: [link({ status: "crawled" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
				issueSave: { readlists: [{ readlist: WORK, label: "Work" }, { readlist: science, label: "Science" }], held: false },
			},
			filter: { readlist: WORK, show: "fit" },
		});
		expect(vm.articles.notices.map(({ text }) => text)).toEqual(["Saved this issue to All, Work, and Science."]);
		expect(vm.articles.readlistLines).toEqual([]);
	});

	it("says the issue was held for a read-only reader", () => {
		const vm = build({
			links: [link({ status: "crawled" })],
			linksMeta: { truncated: false, extractionFailed: false, issueSave: { readlists: [{ readlist: WORK, label: "Work" }], held: true } },
		});
		expect(vm.articles.notices.map(({ text }) => text)).toEqual(["This issue wasn't saved because this account is read-only."]);
		expect(vm.articles.panelPollUrl).toBeUndefined();
	});

	it("reports the issue before its articles, with the readlist line, when the reader asked for both", () => {
		const vm = build({
			links: [link({ status: "crawled" })],
			linksMeta: {
				truncated: false,
				extractionFailed: false,
				selectedReadlists: [{ readlist: WORK, label: "Work" }],
				eligibleArticleCount: 1,
				savesHeld: false,
				readlistOutcomes: [{ readlist: WORK, readlistLabel: "Work", decision: "filtered", fit: [] }],
				issueSave: { readlists: [{ readlist: WORK, label: "Work" }], held: false },
			},
		});
		expect(vm.articles.notices.map(({ text }) => text)).toEqual([
			"Saved this issue to All and Work.",
			"Saved to All.",
		]);
		expect(vm.articles.readlistLines.map(({ text }) => text)).toEqual(["Nothing in this issue fit Work."]);
	});
});

it("confirms eligible Gmail articles retained in All when no custom readlists were selected", () => {
	const vm = build({ links: [link({ status: "crawled" })], linksMeta: { truncated: false, extractionFailed: false, selectedReadlists: [], eligibleArticleCount: 1, savesHeld: false, readlistOutcomes: [] } });
	expect(vm.articles.notices.map(({ text }) => text)).toEqual(["Saved to All."]);
	expect(vm.articles.readlistLines).toEqual([]);
	expect(vm.articles.panelPollUrl).toBeUndefined();
});
