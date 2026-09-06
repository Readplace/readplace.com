import { withInternalTracking } from "@packages/web-shell";
import { validateSaveableUrl } from "@packages/domain/article";
import type {
	EmailLinkSkipReason,
	InboxEmailLinkEntry,
	InboxLinkSaveState,
} from "@packages/domain/inbox";
import { buildInboxExcludedLinkPollUrl } from "./inbox-excluded-link-poll-url";
import { buildInboxLinkSaveUrl } from "./inbox-link-save-url";
import {
	type InboxSaveButtonViewModel,
	toInboxSaveButtonViewModel,
} from "./inbox-save-button.viewmodel";

export const INITIAL_SAVE_POLL_COUNT = 1;

const SKIP_REASON_LABELS: Record<EmailLinkSkipReason, string> = {
	"list-unsubscribe": "Unsubscribe link",
	"action-link-pattern": "Unsubscribe or account link",
	"llm-noise": "Not an article",
	"llm-ad": "Advertisement",
	"llm-menu": "Site navigation",
	"llm-subscription": "Subscription management",
};

const GENERIC_EXCLUDED_LABEL = "Not an article";

export interface ExcludedLinkViewModel {
	ordinal: string;
	url: string;
	reasonLabel: string;
	saveAction: string | undefined;
	domId: string;
	/** Stable id so htmx can hand keyboard focus back to the Save button after the
	 * swap replaces the row the reader was keyboarding through. Mirrors the card
	 * action's `inbox-card-{ordinal}-{key}` scheme. */
	saveButtonId: string;
	saveButton: InboxSaveButtonViewModel;
	pollUrl: string | undefined;
}

export type ExcludedLinkPollContext =
	| { mode: "static" }
	| { mode: "save-poll"; pollCount: number; maxPolls: number };

function saveSettlePollUrl(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	saveState: InboxLinkSaveState | undefined;
	pollContext: ExcludedLinkPollContext;
}): string | undefined {
	const { pollContext } = input;
	if (pollContext.mode === "static") return undefined;
	if (input.saveState !== undefined) return undefined;
	if (pollContext.pollCount > pollContext.maxPolls) return undefined;
	return buildInboxExcludedLinkPollUrl({
		emailId: input.emailId,
		ordinal: input.link.ordinal,
		pollCount: pollContext.pollCount,
	});
}

export function toInboxExcludedLinkViewModel(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	pollContext: ExcludedLinkPollContext;
}): ExcludedLinkViewModel {
	const { link, emailId, linkSaveStates } = input;
	const domId = `inbox-skipped-${link.ordinal}`;
	const pollUrl = saveSettlePollUrl({
		link,
		emailId,
		saveState: linkSaveStates.get(link.url),
		pollContext: input.pollContext,
	});
	return {
		ordinal: link.ordinal,
		url: link.url,
		reasonLabel:
			link.skipReason === undefined
				? GENERIC_EXCLUDED_LABEL
				: SKIP_REASON_LABELS[link.skipReason],
		saveAction:
			validateSaveableUrl(link.url).status === "SUCCESS"
				? withInternalTracking(buildInboxLinkSaveUrl({ emailId, ordinal: link.ordinal }), {
						source: "inbox-excluded-link",
						content: "save-link",
					})
				: undefined,
		domId,
		saveButtonId: `${domId}-save`,
		// A skipped row shows its URL byte-exact — no crawl has resolved it —
		// so the key it is looked up by is also the one the label names.
		saveButton: toInboxSaveButtonViewModel({
			linkSaveStates,
			url: link.url,
			displayUrl: link.url,
			whenNotSaved: pollUrl === undefined ? "unsaved" : "saving",
		}),
		pollUrl,
	};
}
