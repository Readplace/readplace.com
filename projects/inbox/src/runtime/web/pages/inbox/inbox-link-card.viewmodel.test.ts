import assert from "node:assert/strict";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
	type InboxLinkSaveState,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	type LinkCardSavePollContext,
	toInboxLinkCardViewModel,
} from "./inbox-link-card.viewmodel";

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: 40, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(pending.url).toBe("https://link.mail.example.com/ss/c/token?utm_source=nl");
	});

	it("treats a crawled link whose page had no title as a bare row", () => {
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: undefined }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(crawled.cardPollUrl).toBeUndefined();
		expect(crawled.hasTitle).toBe(false);
	});

	it("treats a skipped link as terminal so its card never polls", () => {
		const skipped = toInboxLinkCardViewModel({
			link: link({ status: "skipped", skipReason: "list-unsubscribe" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(skipped.cardPollUrl).toBeUndefined();
		expect(skipped.hasTitle).toBe(false);
	});

	it("stops polling a still-pending link once the poll budget is spent", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(vm.cardPollUrl).toBeUndefined();
		expect(vm.hasTitle).toBe(false);
	});

	it("tells the reader a preview is on its way while the card is still polling", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(vm.statusState).toBe("working");
		expect(vm.statusLabel).toBe("Fetching preview…");
	});

	it("distinguishes a pending link that spent its poll budget from one that finished", () => {
		const stalled = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "Done" }),
			emailId: EMAIL_ID,
			pollCount: 301,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(vm.statusState).toBe("failed");
		expect(vm.statusLabel).toBe("No preview available");
	});

	it("says nothing on a crawled card, where the title is the signal", () => {
		const vm = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "A real title" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(vm.statusState).toBe("none");
		expect(vm.statusLabel).toBe("");
	});

	it("keeps the card and action ids identical across a poll swap so focus can be restored", () => {
		const pending = toInboxLinkCardViewModel({
			link: link({ status: "pending" }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });
		const crawled = toInboxLinkCardViewModel({
			link: link({ status: "crawled", title: "Now resolved" }),
			emailId: EMAIL_ID,
			pollCount: 2,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

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
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });
		const second = toInboxLinkCardViewModel({
			link: link({ ordinal: EmailLinkOrdinalSchema.parse("0003") }),
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: SHOWN, linkSaveStates: new Map(), savePollContext: { mode: "static" } });

		expect(first.domId).toBe("inbox-card-0002");
		expect(second.domId).toBe("inbox-card-0003");
		expect(first.actions.map((a) => a.buttonId)).toEqual([
			"inbox-card-0002-save",
			"inbox-card-0002-feedback-exclude",
		]);
	});
	describe("the save button's saved state", () => {
		const saveAction = (linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>) => {
			const vm = toInboxLinkCardViewModel({
				link: link(),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN,
				linkSaveStates,
				savePollContext: { mode: "static" },
			});
			const action = vm.actions.find((a) => a.key === "save");
			assert(action, "a saveable link must render a save action");
			return action;
		};

		it("reads as unsaved when the link has no recorded save", () => {
			const action = saveAction(new Map());

			expect(action.saveState).toBe("unsaved");
			expect(action.label).toBe("Save to queue");
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
			expect(action.label).toBe("Save to queue");
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

			expect(action.ariaLabel).toBe("Saved to queue \u2014 save again: https://example.com/post");
		});

		it("keys save state on the stored url, not the crawled destination", () => {
			const vm = toInboxLinkCardViewModel({
				link: link({ status: "crawled", title: "T", resolvedUrl: "https://destination.test/a" }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN,
				linkSaveStates: new Map([["https://example.com/post", "saved"]]),
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
				link: input.link ?? link({ status: "crawled", title: "T" }),
				emailId: EMAIL_ID,
				pollCount: 1,
				maxPolls: 300,
				shown: SHOWN,
				linkSaveStates:
					input.saveState === undefined
						? new Map()
						: new Map([["https://example.com/post", input.saveState]]),
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
					ariaLabel: "Saving to queue: https://example.com/post",
					saveState: "saving",
					iconName: undefined,
					buttonId: "inbox-card-0002-save",
					href: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/save`,
					method: "POST",
					hiddenParams: { shown: "20" },
					inPlaceTargetId: "inbox-card-0002",
				},
				{
					key: "feedback-exclude",
					label: "Not an article (report)",
					ariaLabel: "Not an article (report): https://example.com/post",
					buttonId: "inbox-card-0002-feedback-exclude",
					href: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/feedback`,
					method: "POST",
					hiddenParams: { shown: "20", verdict: "should-be-excluded" },
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
			expect(vm.actions[0]?.label).toBe("Save to queue");
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
});
