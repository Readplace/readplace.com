import { withInternalTracking } from "@packages/web-shell";
import { validateSaveableInboxLink } from "../../../domain/inbox/saveable-inbox-link";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import type { EmailLinkSkipReason, InboxEmailLinkEntry } from "@packages/domain/inbox";
import type { InboxCardSaveAction } from "./inbox-link-card.viewmodel";
import { buildInboxLinkSaveUrl } from "./inbox-link-save-url";

const { t } = translator(inbox, DEFAULT_LOCALE);

const SKIP_REASON_LABELS: Record<EmailLinkSkipReason, string> = {
	"list-unsubscribe": "Unsubscribe link",
	"action-link-pattern": "Unsubscribe or account link",
	"llm-noise": "Not an article",
	"llm-ad": "Advertisement",
	"llm-menu": "Site navigation",
	"llm-subscription": "Subscription management",
	"social-host": "Social link — not saved automatically",
};

const GENERIC_EXCLUDED_LABEL = "Not an article";

function reasonLabelFor(link: InboxEmailLinkEntry): string {
	return link.skipReason === undefined ? GENERIC_EXCLUDED_LABEL : SKIP_REASON_LABELS[link.skipReason];
}

export interface ExcludedLinkViewModel {
	ordinal: string;
	url: string;
	reasonLabel: string;
	domId: string;
	actions: InboxCardSaveAction[];
}

export function toInboxExcludedLinkViewModel(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
}): ExcludedLinkViewModel {
	const { link, emailId } = input;
	const domId = `inbox-skipped-${link.ordinal}`;
	const actions: InboxCardSaveAction[] = [];
	if (validateSaveableInboxLink(link.url).status === "SUCCESS") {
		actions.push({
			key: "save",
			label: t("excludedLink.save.label"),
			ariaLabel: t("excludedLink.save.ariaLabel", { url: link.url }),
			saveState: "unsaved",
			iconName: undefined,
			buttonId: `${domId}-save`,
			href: withInternalTracking(buildInboxLinkSaveUrl({ emailId, ordinal: link.ordinal }), {
				source: "inbox-excluded-link",
				content: "save-link",
			}),
			method: "POST",
			inPlaceTargetId: domId,
		});
	}
	return {
		ordinal: link.ordinal,
		url: link.url,
		reasonLabel: reasonLabelFor(link),
		domId,
		actions,
	};
}
