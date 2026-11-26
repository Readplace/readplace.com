import assert from "node:assert/strict";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
	type InboxLinkSaveState,
} from "@packages/domain/inbox";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import {
	type LinkCardSavePollContext,
	toInboxLinkCardViewModel,
} from "./inbox-link-card.viewmodel";
import type { InboxLinkCardReadlistFit } from "./inbox-readlist-fit";

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
		anchorText: undefined,
		...overrides,
	};
}

describe("toInboxLinkCardViewModel", () => {
	describe("the url a card shows", () => {
		const TRACKER = "https://link.mail.beehiiv.com/ss/c/u001.token-for-the-post/4ab/h1/sig";
		const SECOND_TRACKER = "https://link.mail.beehiiv.com/ss/c/u001.second-hop/4ab/h1/sig";
		const urlShown = (input: { status: "crawled" | "failed"; resolvedUrl: string | undefined }) =>
			toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: link({ url: TRACKER, status: input.status, resolvedUrl: input.resolvedUrl }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN,
				filter: undefined,
				fit: [],
				linkSaveStates: new Map([[TRACKER, "saved"]]),
				savedDestinations: new Map([[TRACKER, "https://example.com/saved-destination"]]),
				savePollContext: { mode: "static" },
			}).url;

		it("is the destination a save resolved when the preview crawl left the tracker", () => {
			expect(urlShown({ status: "failed", resolvedUrl: undefined })).toBe("https://example.com/saved-destination");
		});

		it("is the destination a save resolved over wherever a failed preview stopped", () => {
			expect(urlShown({ status: "failed", resolvedUrl: SECOND_TRACKER })).toBe(
				"https://example.com/saved-destination",
			);
		});

		it("is the preview crawl's destination when the preview succeeded", () => {
			expect(urlShown({ status: "crawled", resolvedUrl: "https://example.com/crawled-destination" })).toBe(
				"https://example.com/crawled-destination",
			);
		});

		it("is the destination a save resolved when a succeeded preview stored none", () => {
			expect(urlShown({ status: "crawled", resolvedUrl: undefined })).toBe("https://example.com/saved-destination");
		});
	});

	it("keeps polling a pending link below the poll budget", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.cardPollUrl).toContain("/links/0002/card");
		expect(vm.cardPollUrl).toContain("poll=1");
		// The re-rendered card has to keep posting the page size back, so a save
		// from an expanded list still returns the reader to the same page.
		expect(vm.cardPollUrl).toContain("shown=20");
		expect(vm.title).toBe("");
		expect(vm.hasTitle).toBe(false);
		expect(vm.actions.map((action) => [action.key, action.href])).toEqual([
			["save", `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/save?utm_source=inbox-link-card&utm_medium=internal&utm_content=save-link`],
		]);
		expect(vm.menuActions.map((action) => [action.key, action.href])).toEqual([
			[
				"feedback-exclude",
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/feedback?utm_source=inbox-link-card&utm_medium=internal&utm_content=feedback-exclude`,
			],
		]);
	});

	it("posts the panel's page size back from every action, so neither loses the reader's place", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "crawled", title: "T" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: 40, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(
			[...vm.actions, ...vm.menuActions].map((action) => [action.key, action.hiddenParams]),
		).toEqual([
			["save", { shown: "40" }],
			["feedback-exclude", { shown: "40", verdict: "should-be-excluded" }],
		]);
	});

	it("offers no save action for a link the save pipeline would reject", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ url: "https://localhost/private" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.actions).toEqual([]);
		expect(vm.menuActions.map((action) => action.key)).toEqual(["feedback-exclude"]);
	});

	it("offers no save action for a private item identity", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.actions).toEqual([]);
	});

	it("labels the save action with the destination the card shows, not the tracking link", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({
				status: "crawled",
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				resolvedUrl: "https://destination.test/the-actual-article",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.actions[0]?.ariaLabel).toBe(
			"Save to the default readlist: https://destination.test/the-actual-article",
		);
	});

	it("stops polling once a link reaches a terminal state", () => {
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "crawled", title: "T" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.cardPollUrl).toBeUndefined();
		expect(crawled.title).toBe("T");
		expect(crawled.hasTitle).toBe(true);
		expect(crawled.url).toBe("https://example.com/post");
	});

	it("shows the post-redirect destination instead of the newsletter tracking link once resolved", () => {
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({
				status: "crawled",
				title: "T",
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				resolvedUrl: "https://destination.test/the-actual-article",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.url).toBe("https://destination.test/the-actual-article");
	});

	it("shows the destination a failed preview reached instead of the newsletter tracking link", () => {
		const failed = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({
				status: "failed",
				failureReason: "blocked",
				url: "https://click.convertkit-mail.test/abc123",
				resolvedUrl: "https://www.telegraph.test/news/the-actual-article?utm_source=newsletter",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(failed.url).toBe("https://www.telegraph.test/news/the-actual-article");
		expect(failed.statusState).toBe("failed");
	});

	it("drops the newsletter's utm tags from a crawled link that never redirected", () => {
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({
				status: "crawled",
				title: "T",
				url: "https://example.com/post?id=7&utm_source=nl&utm_medium=email",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.url).toBe("https://example.com/post?id=7");
	});

	it("drops utm tags the redirect destination itself carries", () => {
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({
				status: "crawled",
				title: "T",
				url: "https://nodeweekly.com/link/187980/4be0b3f821",
				resolvedUrl: "https://destination.test/article?utm_campaign=weekly&ref=nodeweekly",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.url).toBe("https://destination.test/article?ref=nodeweekly");
		expect(
			[...crawled.actions, ...crawled.menuActions].map((action) => action.ariaLabel),
		).toEqual([
			"Save to the default readlist: https://destination.test/article?ref=nodeweekly",
			"Not an article (report): https://destination.test/article?ref=nodeweekly",
		]);
	});

	it("shows a pending wrapper byte-exact, since stripping could break a signed query", () => {
		const pending = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({
				status: "pending",
				url: "https://link.mail.example.com/ss/c/token?utm_source=nl",
			}),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(pending.url).toBe("https://link.mail.example.com/ss/c/token?utm_source=nl");
	});

	describe("a tracker link that carries its destination", () => {
		const TRACKER = "https://click.tracker.test/c?id=42&url=https%3A%2F%2Fdestination.test%2Fpost%3Fref%3Dnl%26utm_source%3Dnl";
		const OPAQUE_TRACKER = "https://click.tracker.test/c/opaque?utm_source=nl";

		function cardUrl(overrides: Partial<InboxEmailLinkEntry>): string {
			return toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: link(overrides),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } }).url;
		}

		it.each(["pending", "failed", "crawled"] as const)("shows the decoded destination, without utm tags, on a %s card", (status) => {
			expect(cardUrl({ status, url: TRACKER })).toBe("https://destination.test/post?ref=nl");
		});

		it("shows a pending tracker with nothing to decode byte-exact", () => {
			expect(cardUrl({ status: "pending", url: OPAQUE_TRACKER })).toBe(OPAQUE_TRACKER);
		});

		it("shows a failed tracker with nothing to decode without its utm tags", () => {
			expect(cardUrl({ status: "failed", url: OPAQUE_TRACKER })).toBe("https://click.tracker.test/c/opaque");
		});

		it("prefers where the crawl landed over the destination the tracker carries", () => {
			expect(cardUrl({ status: "crawled", url: TRACKER, resolvedUrl: "https://landed.test/post" })).toBe(
				"https://landed.test/post",
			);
		});

		it("still posts the stored tracker link when saved", () => {
			const vm = toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: link({ status: "failed", url: TRACKER }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map([[TRACKER, "saved"]]), savedDestinations: new Map(), savePollContext: { mode: "static" } });

			expect(vm.actions[0]?.saveState).toBe("saved");
			expect(vm.actions[0]?.ariaLabel).toContain("https://destination.test/post?ref=nl");
		});
	});

	it("treats a crawled link whose page had no title as a bare row", () => {
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "crawled", title: undefined }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.cardPollUrl).toBeUndefined();
		expect(crawled.hasTitle).toBe(false);
	});

	it("treats a skipped link as terminal so its card never polls", () => {
		const skipped = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "skipped", skipReason: "list-unsubscribe" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(skipped.cardPollUrl).toBeUndefined();
		expect(skipped.hasTitle).toBe(false);
	});

	it("stops polling a still-pending link once the poll budget is spent", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.cardPollUrl).toBeUndefined();
		expect(vm.hasTitle).toBe(false);
	});

	it("tells the reader a preview is on its way while the card is still polling", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.statusState).toBe("working");
		expect(vm.statusLabel).toBe("Fetching preview…");
	});

	it("distinguishes a pending link that spent its poll budget from one that finished", () => {
		const stalled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "crawled", title: "Done" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		// Both stopped polling, so cardPollUrl alone cannot tell them apart.
		expect(stalled.cardPollUrl).toBeUndefined();
		expect(crawled.cardPollUrl).toBeUndefined();
		expect(stalled.statusState).toBe("stalled");
		expect(crawled.statusState).toBe("none");
	});

	it("marks a failed crawl so a bare URL is not mistaken for one still arriving", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "failed", failureReason: "timeout" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.statusState).toBe("failed");
		expect(vm.statusLabel).toBe("No preview available");
	});

	it("says nothing on a crawled card, where the title is the signal", () => {
		const vm = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "crawled", title: "A real title" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(vm.statusState).toBe("none");
		expect(vm.statusLabel).toBe("");
	});

	it("keeps the card and action ids identical across a poll swap so focus can be restored", () => {
		const pending = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });
		const crawled = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ status: "crawled", title: "Now resolved" }),
			emailId: EMAIL_ID,
			pollCount: 2,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.domId).toBe(pending.domId);
		expect([...crawled.actions, ...crawled.menuActions].map((a) => a.buttonId)).toEqual(
			[...pending.actions, ...pending.menuActions].map((a) => a.buttonId),
		);
	});

	it("gives each card on the page its own ids so a swap cannot reattach focus to a sibling", () => {
		const first = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ ordinal: EmailLinkOrdinalSchema.parse("0002") }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });
		const second = toInboxLinkCardViewModel({
			paidFeaturesLocked: false,
			link: link({ ordinal: EmailLinkOrdinalSchema.parse("0003") }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, filter: undefined, fit: [], linkSaveStates: new Map(), savedDestinations: new Map(), savePollContext: { mode: "static" } });

		expect(first.domId).toBe("inbox-card-0002");
		expect(second.domId).toBe("inbox-card-0003");
		expect([...first.actions, ...first.menuActions].map((a) => a.buttonId)).toEqual([
			"inbox-card-0002-save",
			"inbox-card-0002-feedback-exclude",
		]);
	});
	describe("the save button's saved state", () => {
		const saveAction = (linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>) => {
			const vm = toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: link(),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN, filter: undefined, fit: [],
				linkSaveStates,
				savedDestinations: new Map(),
				savePollContext: { mode: "static" },
			});
			const action = vm.actions.find((a) => a.key === "save");
			assert(action, "a saveable link must render a save action");
			return action;
		};

		it("reads as unsaved when the link has no recorded save", () => {
			const action = saveAction(new Map());

			expect(action.saveState).toBe("unsaved");
			expect(action.label).toBe("Save to the default readlist");
			expect(action.iconName).toBeUndefined();
		});

		it("reads as saved once a save was accepted for that url", () => {
			const action = saveAction(new Map([["https://example.com/post", "saved"]]));

			expect(action.saveState).toBe("saved");
			expect(action.label).toBe("Save again");
			expect(action.iconName).toBe("check");
		});

		it("reads as unsaved when the save failed, so the reader can try again", () => {
			const action = saveAction(new Map([["https://example.com/post", "failed"]]));

			expect(action.saveState).toBe("unsaved");
			expect(action.label).toBe("Save to the default readlist");
		});

		it("keeps a saved link's action posting the same save route", () => {
			const unsaved = saveAction(new Map());
			const saved = saveAction(new Map([["https://example.com/post", "saved"]]));

			expect(saved.href).toBe(unsaved.href);
			expect(saved.method).toBe(unsaved.method);
			expect(saved.buttonId).toBe(unsaved.buttonId);
			expect(saved.hiddenParams).toEqual(unsaved.hiddenParams);
		});

		it("names the link in the saved button's accessible label", () => {
			const action = saveAction(new Map([["https://example.com/post", "saved"]]));

			expect(action.ariaLabel).toBe("Saved to the default readlist \u2014 save again: https://example.com/post");
		});

		it("keys save state on the stored url, not the crawled destination", () => {
			const vm = toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: link({ status: "crawled", title: "T", resolvedUrl: "https://destination.test/a" }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN, filter: undefined, fit: [],
				linkSaveStates: new Map([["https://example.com/post", "saved"]]),
				savedDestinations: new Map(),
				savePollContext: { mode: "static" },
			});

			const action = vm.actions.find((a) => a.key === "save");
			assert(action, "a saveable link must render a save action");
			expect(action.saveState).toBe("saved");
		});
	});
	describe("the save-settle poll", () => {
		const savePoll = (pollCount: number): LinkCardSavePollContext => ({
			mode: "save-poll",
			pollCount,
			maxPolls: 20,
		});

		const build = (input: {
			link?: InboxEmailLinkEntry;
			saveState?: InboxLinkSaveState;
			savePollContext: LinkCardSavePollContext;
		}) =>
			toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: input.link ?? link({ status: "crawled", title: "T" }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN, filter: undefined, fit: [],
				linkSaveStates:
					input.saveState === undefined
						? new Map()
						: new Map([["https://example.com/post", input.saveState]]),
				savedDestinations: new Map(),
				savePollContext: input.savePollContext,
			});

		it("polls a crawled card for its own save while the save has not reached the read model", () => {
			const vm = build({ savePollContext: savePoll(4) });

			expect(vm.cardPollUrl).toBe(
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/card?poll=4&shown=20&awaitSave=1`,
			);
			expect(vm.actions).toEqual([
				{
					key: "save",
					label: "Saving…",
					ariaLabel: "Saving to the default readlist: https://example.com/post",
					saveState: "saving",
					iconName: undefined,
					buttonId: "inbox-card-0002-save",
					href: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/save?utm_source=inbox-link-card&utm_medium=internal&utm_content=save-link`,
					method: "POST",
					hiddenParams: { shown: "20" },
					inPlaceTargetId: "inbox-card-0002",
				},
			]);
			expect(vm.menuActions).toEqual([
				{
					key: "feedback-exclude",
					label: "Not an article (report)",
					ariaLabel: "Not an article (report): https://example.com/post",
					buttonId: "inbox-card-0002-feedback-exclude",
					href: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/feedback?utm_source=inbox-link-card&utm_medium=internal&utm_content=feedback-exclude`,
					method: "POST",
					hiddenParams: { shown: "20", verdict: "should-be-excluded" },
					iconName: "x",
				},
			]);
		});

		it("stops polling the moment the save is recorded", () => {
			const vm = build({ saveState: "saved", savePollContext: savePoll(4) });

			expect(vm.cardPollUrl).toBeUndefined();
			expect(vm.actions[0]?.saveState).toBe("saved");
			expect(vm.actions[0]?.label).toBe("Save again");
		});

		it("stops polling on a recorded failure and offers the save again", () => {
			const vm = build({ saveState: "failed", savePollContext: savePoll(4) });

			expect(vm.cardPollUrl).toBeUndefined();
			expect(vm.actions[0]?.saveState).toBe("unsaved");
			expect(vm.actions[0]?.label).toBe("Save to the default readlist");
		});

		it("keeps polling on the last tick the settle budget allows", () => {
			expect(build({ savePollContext: savePoll(20) }).cardPollUrl).toBe(
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/card?poll=20&shown=20&awaitSave=1`,
			);
		});

		it("gives up rather than claim Saving… forever once the settle budget is spent", () => {
			const vm = build({ savePollContext: savePoll(21) });

			expect(vm.cardPollUrl).toBeUndefined();
			expect(vm.actions[0]?.saveState).toBe("unsaved");
		});

		it("still reads a pending crawl as working while the card is polling for its save", () => {
			const vm = build({ link: link({ status: "pending" }), savePollContext: savePoll(4) });

			expect(vm.cardPollUrl).toBe(
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/card?poll=4&shown=20&awaitSave=1`,
			);
			expect(vm.statusState).toBe("working");
		});

		it("hands a still-pending card back to its crawl poll once the save settles", () => {
			const vm = build({
				link: link({ status: "pending" }),
				saveState: "saved",
				savePollContext: savePoll(4),
			});

			expect(vm.cardPollUrl).toBe(
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/card?poll=1&shown=20`,
			);
		});
	});

	describe("the readlist fit markers and controls", () => {
		const WORK = ReadlistSlugSchema.parse("work");
		const SCIENCE = ReadlistSlugSchema.parse("science");
		const ORDINAL = EmailLinkOrdinalSchema.parse("0002");

		const override = (readerVerdict: ReadlistFitOverride["readerVerdict"]): ReadlistFitOverride => ({
			id: ReadlistFitOverrideIdSchema.parse(`0000000000000001-${EMAIL_ID}-0002`),
			url: "https://example.com/post",
			anchorText: "Post",
			host: "example.com",
			readerVerdict,
			receivedAtMessageId: EMAIL_ID,
			ordinal: ORDINAL,
			createdAt: new Date("2026-10-14T10:00:00.000Z"),
		});

		const readlistFit = (input: {
			readlist?: InboxLinkCardReadlistFit["readlist"];
			label?: string;
			decision?: InboxLinkCardReadlistFit["outcome"]["decision"];
			fit?: InboxLinkCardReadlistFit["outcome"]["fit"];
			override?: ReadlistFitOverride;
		}): InboxLinkCardReadlistFit => {
			const readlist = input.readlist ?? WORK;
			const label = input.label ?? "Work";
			return {
				readlist,
				label,
				outcome: {
					readlist,
					readlistLabel: label,
					decision: input.decision ?? "filtered",
					fit: input.fit ?? [],
				},
				override: input.override,
			};
		};

		const engine = (verdict: "keep" | "drop" | "unsure", reason = "About distributed systems.") => [
			{ ordinal: ORDINAL, verdict, reason },
		];

		const build = (input: {
			fit: InboxLinkCardReadlistFit[];
			link?: InboxEmailLinkEntry;
			filter?: { readlist: typeof WORK; show: "fit" | "rest" };
			shown?: number;
		}) =>
			toInboxLinkCardViewModel({
				paidFeaturesLocked: false,
				link: input.link ?? link({ status: "crawled", title: "T" }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: input.shown ?? SHOWN,
				filter: input.filter,
				fit: input.fit,
				linkSaveStates: new Map(),
				savedDestinations: new Map(),
				savePollContext: { mode: "static" },
			});

		const fitUrl = (query: string) =>
			`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/fit?${query}`;

		it("marks an engine keep as fitting, with its reason, and offers Doesn't fit", () => {
			const vm = build({ fit: [readlistFit({ fit: engine("keep") })] });

			expect(vm.fitMarkers).toEqual([
				{ readlist: WORK, text: "Fits Work", accent: true, reason: "About distributed systems.", chosenOn: undefined },
			]);
			expect(vm.fitActions).toEqual([
				{
					key: "fit-drop",
					readlist: WORK,
					label: "Doesn't fit Work",
					ariaLabel: "Doesn't fit Work: https://example.com/post",
					buttonId: "inbox-card-0002-fit-drop-work",
					href: fitUrl("tab=articles&utm_source=inbox-link-card&utm_medium=internal&utm_content=fit-drop"),
					method: "POST",
					hiddenParams: { readlist: "work", verdict: "drop" },
					inPlaceTargetId: "inbox-card-0002",
				},
			]);
		});

		it("marks an engine drop as not for the readlist, with its reason, and offers Keep", () => {
			const vm = build({ fit: [readlistFit({ fit: engine("drop", "A product launch.") })] });

			expect(vm.fitMarkers).toEqual([
				{ readlist: WORK, text: "Not for Work", accent: false, reason: "A product launch.", chosenOn: undefined },
			]);
			expect(vm.fitActions.map((action) => [action.key, action.label, action.hiddenParams])).toEqual([
				["fit-keep", "Keep in Work", { readlist: "work", verdict: "keep" }],
			]);
		});

		it("marks an unsure call as not for the readlist without a reason line", () => {
			const vm = build({ fit: [readlistFit({ fit: engine("unsure", "Could go either way.") })] });

			expect(vm.fitMarkers).toEqual([
				{ readlist: WORK, text: "Not for Work", accent: false, reason: undefined, chosenOn: undefined },
			]);
			expect(vm.fitActions.map((action) => action.label)).toEqual(["Keep in Work"]);
		});

		it("marks the reader's keep with the day they chose it and offers Doesn't fit", () => {
			const vm = build({ fit: [readlistFit({ fit: engine("drop"), override: override("keep") })] });

			expect(vm.fitMarkers).toEqual([
				{
					readlist: WORK,
					text: "Kept in Work",
					accent: true,
					reason: undefined,
					chosenOn: { iso: "2026-10-14T10:00:00.000Z", label: "Oct 14, 2026", mode: "date" },
				},
			]);
			expect(vm.fitActions.map((action) => action.label)).toEqual(["Doesn't fit Work"]);
		});

		it("marks the reader's drop with the day they chose it and offers Keep", () => {
			const vm = build({ fit: [readlistFit({ fit: engine("keep"), override: override("drop") })] });

			expect(vm.fitMarkers.map((marker) => [marker.text, marker.accent, marker.chosenOn?.label])).toEqual([
				["Not in Work", false, "Oct 14, 2026"],
			]);
			expect(vm.fitActions.map((action) => action.label)).toEqual(["Keep in Work"]);
		});

		it("shows no marker under a failed outcome but offers Keep on a saveable card", () => {
			const vm = build({ fit: [readlistFit({ decision: "failed" })] });

			expect(vm.fitMarkers).toEqual([]);
			expect(vm.fitActions.map((action) => [action.key, action.label])).toEqual([["fit-keep", "Keep in Work"]]);
		});

		it("offers no fit control on an unsaveable card under a failed outcome", () => {
			const vm = build({
				link: link({ url: "https://localhost/private" }),
				fit: [readlistFit({ decision: "failed" })],
			});

			expect(vm.fitMarkers).toEqual([]);
			expect(vm.fitActions).toEqual([]);
		});

		it.each(["no-purpose", "readlist-missing", "smart-matching"] as const)(
			"shows no marker or control for a %s outcome",
			(decision) => {
				const vm = build({ fit: [readlistFit({ decision, fit: engine("keep") })] });

				expect(vm.fitMarkers).toEqual([]);
				expect(vm.fitActions).toEqual([]);
			},
		);

		it("shows no marker or control for a card the filtered outcome has no entry for", () => {
			const vm = build({
				fit: [readlistFit({ fit: [{ ordinal: EmailLinkOrdinalSchema.parse("0009"), verdict: "keep", reason: "r" }] })],
			});

			expect(vm.fitMarkers).toEqual([]);
			expect(vm.fitActions).toEqual([]);
		});

		it("gives two routed readlists two markers and differently named controls", () => {
			const vm = build({
				fit: [
					readlistFit({ fit: engine("keep") }),
					readlistFit({ readlist: SCIENCE, label: "Science", fit: engine("drop") }),
				],
			});

			expect(vm.fitMarkers.map((marker) => [marker.readlist, marker.text])).toEqual([
				["work", "Fits Work"],
				["science", "Not for Science"],
			]);
			expect(vm.fitActions.map((action) => [action.ariaLabel, action.buttonId])).toEqual([
				["Doesn't fit Work: https://example.com/post", "inbox-card-0002-fit-drop-work"],
				["Keep in Science: https://example.com/post", "inbox-card-0002-fit-keep-science"],
			]);
		});

		it("carries the page state on the fit URL and on every other action and poll", () => {
			const vm = build({
				link: link({ status: "pending" }),
				fit: [readlistFit({ fit: engine("keep") })],
				filter: { readlist: WORK, show: "rest" },
				shown: 40,
			});

			expect(vm.fitActions.map((action) => action.href)).toEqual([
				fitUrl("tab=articles&shown=40&readlist=work&show=rest&utm_source=inbox-link-card&utm_medium=internal&utm_content=fit-drop"),
			]);
			expect(vm.actions.map((action) => action.hiddenParams)).toEqual([
				{ shown: "40", readlist: "work", show: "rest" },
			]);
			expect(vm.menuActions.map((action) => action.hiddenParams)).toEqual([
				{ shown: "40", readlist: "work", show: "rest", verdict: "should-be-excluded" },
			]);
			expect(vm.cardPollUrl).toBe(
				`/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/card?poll=1&shown=40&readlist=work&show=rest`,
			);
		});
	});
});
