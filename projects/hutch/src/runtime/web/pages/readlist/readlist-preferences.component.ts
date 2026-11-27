import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AliasName, InboxAddressEntry } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderToast,
} from "@packages/web-shell";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import type { AlertContent, CspNonce, PageBody } from "@packages/web-shell";

import { ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import { standingOf } from "../../shared/upgrade-offer/upgrade-offer";
import { WIZARD_STYLES } from "../../shared/wizard/wizard.component";
import { GMAIL_SENDER_WIDGET_STYLES } from "../integrations/gmail.styles";
import { readlistAlertFor } from "./readlist-alerts";
import { STATUS_TOAST_DISMISS_MS } from "./readlist-mutation-fragments";
import { type ReadlistFitChoices, renderReadlistFitChoices } from "./readlist-fit-choices.component";
import { READLIST_GMAIL_SENDERS_STYLES, renderReadlistGmailSenders } from "./readlist-gmail-senders.component";
import type { ReadlistGmailSendersViewModel } from "./readlist-gmail-senders.viewmodel";
import { buildReadlistInboxes, type InboxNameError, renderReadlistInboxes } from "./readlist-inboxes.component";
import {
	buildReadlistNav,
	renderReadlistNav,
} from "./readlist-nav.component";
import {
	buildReadlistTabs,
	renderReadlistTabs,
} from "./readlist-tabs.component";
import {
	READLIST_BODY_CLASS,
	type ReadlistOnboarding,
	readlistPageScripts,
	readlistPanels,
	readlistSideColumn,
} from "./readlist.component";
import { READLIST_STYLES } from "./readlist.styles";
import type { ReadlistPreferencesWizardViewModel } from "./readlist-preferences-wizard.component";
import {
	READLIST_PURPOSE_CARD_STYLES,
	renderReadlistPurposeCard,
	renderReadlistPurposeWizard,
} from "./readlist-purpose-card.component";
import { READLIST_PREFERENCES_STYLES } from "./readlist-preferences.styles";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { type ReadlistFilingMode, renderReadlistSmartFiling } from "./readlist-smart-filing.component";
import { readlistReturnQuery } from "./readlist.url";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-preferences.template.html"), "utf-8");

const WIZARD_OPEN_CLASS = "readlist-preferences--wizard-open";

export interface ReadlistPreferencesViewModel {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	rail: ReadlistRailViewModel;
	values: Partial<ReadlistPreferencesWizardViewModel>;
	wizardOpen: boolean;
	purposeError?: string;
	filing: ReadlistFilingMode;
	smartError: string | undefined;
	inboxes: readonly InboxAddressEntry[];
	inboxCreate: { submittedName: string | undefined; error: InboxNameError | undefined };
	inboxCreated: AliasName | undefined;
	choices: ReadlistFitChoices;
	alert?: AlertContent;
	saved: boolean;
	gmailSenders: ReadlistGmailSendersViewModel | undefined;
	paidFeaturesLocked: boolean;
	subscriptionBanner: SubscriptionBannerState;
	onboarding: ReadlistOnboarding;
	query: Record<string, unknown>;
	cspNonce: CspNonce;
}

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

function statusToastHtml(vm: Pick<ReadlistPreferencesViewModel, "saved" | "inboxCreated">): string {
	if (vm.saved) return renderToast({ message: "Preferences saved", dismissMs: STATUS_TOAST_DISMISS_MS, actions: [] });
	if (vm.inboxCreated === undefined) return "";
	return renderToast({
		message: t("readlistInboxes.create.created", { name: vm.inboxCreated }),
		dismissMs: STATUS_TOAST_DISMISS_MS,
		actions: [],
	});
}

export function ReadlistPreferencesPage(vm: ReadlistPreferencesViewModel): PageBody {
	const standing = standingOf({ gated: vm.paidFeaturesLocked, offer: vm.rail.offer });
	const wizard =
		vm.readlist.purpose !== undefined && standing === "open"
			? renderReadlistPurposeWizard({
				readlist: { slug: vm.readlist.slug },
				values: vm.values,
				from: "preferences",
				error: vm.purposeError,
			})
			: { inlineHtml: "", popoverHtml: "" };
	const panels = readlistPanels(vm.rail);
	const side = readlistSideColumn({
		banner: vm.subscriptionBanner,
		onboarding: vm.onboarding,
		returnQuery: readlistReturnQuery({ readlist: vm.readlist.slug }),
	});

	const content = render(TEMPLATE, {
		readlistNavHtml: renderReadlistNav(
			buildReadlistNav({
				readlists: vm.rail.readlists,
				pinnedReadlists: vm.rail.pinnedReadlists,
				home: vm.rail.home,
				activeSlug: vm.rail.activeReadlist.slug,
				newReadlistAction: vm.rail.newReadlistAction,
				limitAlertHref: vm.rail.limitAlertHref,
				canCreate: vm.rail.canCreate,
			}),
		),
		alertHtml: renderAlert({ key: "readlist", content: vm.alert ?? readlistAlertFor(vm.query) }),
		purposeCardHtml: renderReadlistPurposeCard({ purpose: vm.readlist.purpose, standing, offer: vm.rail.offer }),
		tabsHtml: renderReadlistTabs(
			buildReadlistTabs({
				activeTab: "preferences",
				readlist: vm.readlist.slug,
			}),
		),
		panelClass: ["readlist-listing readlist-preferences", ...(vm.wizardOpen ? [WIZARD_OPEN_CLASS] : [])].join(" "),
		readlistLabel: vm.readlist.label,
		wizardInlineHtml: wizard.inlineHtml,
		smartFilingHtml: renderReadlistSmartFiling({
			slug: vm.readlist.slug,
			mode: vm.filing,
			standing,
			offer: vm.rail.offer,
			error: vm.smartError,
		}),
		inboxesHtml: renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: vm.readlist,
				inboxes: vm.inboxes,
				readlists: vm.rail.readlists,
				create: vm.inboxCreate,
				standing,
				offer: vm.rail.offer,
			}),
		),
		gmailSendersHtml: vm.gmailSenders === undefined ? "" : renderReadlistGmailSenders(vm.gmailSenders),
		choicesHtml: renderReadlistFitChoices({
			readlist: vm.readlist,
			choices: vm.choices,
		}),
		statusToastHtml: statusToastHtml(vm),
		subscriptionHtml: side.subscriptionHtml,
		onboardingHtml: side.onboardingHtml,
		readlistRenamesHtml: panels.renames,
		readlistCreateHtml: panels.create,
		readlistDeleteConfirmHtml: panels.deleteConfirms,
		wizardPopoverHtml: wizard.popoverHtml,
	});

	return {
		seo: {
			title: `${vm.readlist.label} — Readplace`,
			description: "Your saved articles readlist.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: [
			CONFIRM_POPOVER_STYLES,
			ONBOARDING_STYLES,
			READLIST_STYLES,
			WIZARD_STYLES,
			READLIST_PREFERENCES_STYLES,
			READLIST_PURPOSE_CARD_STYLES,
			GMAIL_SENDER_WIDGET_STYLES,
			READLIST_GMAIL_SENDERS_STYLES,
		].join("\n"),
		bodyClass: READLIST_BODY_CLASS,
		content: { html: content },
		scripts: readlistPageScripts(vm.cspNonce),
	};
}
