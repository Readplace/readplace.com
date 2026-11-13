import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AliasName, InboxAddressEntry } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderIllustration,
	renderToast,
} from "@packages/web-shell";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import type { AlertContent, CspNonce, PageBody } from "@packages/web-shell";

import { ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import { type UpgradeOffer, renderedLockFor, standingOf } from "../../shared/upgrade-offer/upgrade-offer";
import { WIZARD_STYLES, type WizardRender } from "../../shared/wizard/wizard.component";
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
import {
	READLIST_PREFERENCES_WIZARD_ID,
	type ReadlistPreferencesWizardViewModel,
} from "./readlist-preferences-wizard.component";
import {
	READLIST_PURPOSE_CARD_STYLES,
	type PurposeState,
	purposeStateOf,
	renderReadlistPurposeCard,
	renderReadlistPurposeWizard,
} from "./readlist-purpose-card.component";
import { READLIST_PREFERENCES_STYLES } from "./readlist-preferences.styles";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { readlistReturnQuery } from "./readlist.url";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-preferences.template.html"), "utf-8");

const PREFERENCES_SOURCE = "queue-preferences";

const PANEL_CLASS: Record<PurposeState, string> = {
	unset: "readlist-preferences readlist-preferences--unset",
	set: "readlist-preferences readlist-preferences--set",
};

const WIZARD_OPEN_CLASS = "readlist-preferences--wizard-open";

const READ_ONLY_CLASS = "readlist-preferences--read-only";

interface PopoverControl {
	popoverId: string;
}

interface PanelControls {
	modifierClasses: readonly string[];
	setupActions: readonly PopoverControl[];
	inlineWizards: readonly string[];
	wizardPopoverHtml: string;
	setupLocks: readonly string[];
}

interface PanelControlsInput {
	wizard: WizardRender;
	wizardOpenClasses: readonly string[];
	state: PurposeState;
	offer: UpgradeOffer | undefined;
}

const SETUP_LOCKS: Record<PurposeState, (offer: UpgradeOffer | undefined) => readonly string[]> = {
	unset: (offer) =>
		renderedLockFor({
			offer,
			gated: true,
			key: "set-up-readlist",
			label: "Set up readlist",
			controlClass: "btn btn--neutral readlist-empty__cta",
			source: PREFERENCES_SOURCE,
		}),
	set: () => [],
};

const PANEL_CONTROLS: Record<PurposeState | "needs-upgrade" | "withheld", (input: PanelControlsInput) => PanelControls> = {
	unset: (input) => ({
		modifierClasses: input.wizardOpenClasses,
		setupActions: [{ popoverId: READLIST_PREFERENCES_WIZARD_ID }],
		inlineWizards: [input.wizard.inlineHtml],
		wizardPopoverHtml: input.wizard.popoverHtml,
		setupLocks: [],
	}),
	set: (input) => ({
		modifierClasses: input.wizardOpenClasses,
		setupActions: [],
		inlineWizards: [input.wizard.inlineHtml],
		wizardPopoverHtml: input.wizard.popoverHtml,
		setupLocks: [],
	}),
	"needs-upgrade": (input) => ({
		modifierClasses: [READ_ONLY_CLASS],
		setupActions: [],
		inlineWizards: [],
		wizardPopoverHtml: "",
		setupLocks: SETUP_LOCKS[input.state](input.offer),
	}),
	withheld: () => ({
		modifierClasses: [READ_ONLY_CLASS],
		setupActions: [],
		inlineWizards: [],
		wizardPopoverHtml: "",
		setupLocks: [],
	}),
};

export interface ReadlistPreferencesViewModel {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	rail: ReadlistRailViewModel;
	values: Partial<ReadlistPreferencesWizardViewModel>;
	wizardOpen: boolean;
	purposeError?: string;
	inboxes: readonly InboxAddressEntry[];
	inboxCreate: { submittedName: string | undefined; error: InboxNameError | undefined };
	inboxCreated: AliasName | undefined;
	choices: ReadlistFitChoices;
	alert?: AlertContent;
	saved: boolean;
	gmailSenders: ReadlistGmailSendersViewModel | undefined;
	accessIsReadOnly: boolean;
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
	const state = purposeStateOf(vm.readlist);
	const standing = standingOf({ gated: vm.accessIsReadOnly, offer: vm.rail.offer });
	const controls = PANEL_CONTROLS[standing === "open" ? state : standing]({
		state,
		offer: vm.rail.offer,
		wizard: renderReadlistPurposeWizard({
			readlist: vm.readlist,
			values: vm.values,
			from: "preferences",
			error: vm.purposeError,
		}),
		wizardOpenClasses: vm.wizardOpen ? [WIZARD_OPEN_CLASS] : [],
	});
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
				activeSlug: vm.rail.activeReadlist.slug,
				newReadlistAction: vm.rail.newReadlistAction,
				limitAlertHref: vm.rail.limitAlertHref,
				canEdit: vm.rail.canEdit,
				canCreate: vm.rail.canCreate,
				offer: vm.rail.offer,
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
		panelClass: [PANEL_CLASS[state], ...controls.modifierClasses].join(" "),
		state,
		readlistLabel: vm.readlist.label,
		setupIllustrationHtml: renderIllustration("book-lightbulb"),
		setupActions: controls.setupActions,
		setupLocks: controls.setupLocks,
		inlineWizards: controls.inlineWizards,
		inboxesHtml: renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: vm.readlist,
				inboxes: vm.inboxes,
				readlists: vm.rail.readlists,
				create: vm.inboxCreate,
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
		wizardPopoverHtml: controls.wizardPopoverHtml,
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
