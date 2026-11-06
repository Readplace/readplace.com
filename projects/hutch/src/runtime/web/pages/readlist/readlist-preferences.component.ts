import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmailDeliveryMode, InboxAddressEntry } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderIllustration,
	withInternalTracking,
} from "@packages/web-shell";
import type { AlertContent, CspNonce, PageBody } from "@packages/web-shell";

import { ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import { type UpgradeOffer, renderedLockFor, standingOf } from "../../shared/upgrade-offer/upgrade-offer";
import { WIZARD_STYLES, type WizardRender, renderWizard } from "../../shared/wizard/wizard.component";
import type { WizardHeading } from "../../shared/wizard/wizard.types";
import { GMAIL_SENDER_WIDGET_STYLES } from "../integrations/gmail.styles";
import { readlistAlertFor } from "./readlist-alerts";
import { type ReadlistFitChoices, renderReadlistFitChoices } from "./readlist-fit-choices.component";
import { READLIST_GMAIL_SENDERS_STYLES, renderReadlistGmailSenders } from "./readlist-gmail-senders.component";
import type { ReadlistGmailSendersViewModel } from "./readlist-gmail-senders.viewmodel";
import { buildReadlistInboxes, renderReadlistInboxes } from "./readlist-inboxes.component";
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
	READLIST_PREFERENCES_STEPS,
	READLIST_PREFERENCES_WIZARD_ID,
	READLIST_PREFERENCES_WIZARD_KEY,
	type ReadlistPreferencesWizardViewModel,
} from "./readlist-preferences-wizard.component";
import { READLIST_PREFERENCES_STYLES } from "./readlist-preferences.styles";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { readlistReturnQuery, readlistPreferencesPath } from "./readlist.url";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-preferences.template.html"), "utf-8");

const PREFERENCES_SOURCE = "queue-preferences";

const PURPOSE_FAILURE_MESSAGE = "Couldn't save the purpose.";

type PurposeState = "unset" | "set";

const PANEL_CLASS: Record<PurposeState, string> = {
	unset: "readlist-preferences readlist-preferences--unset",
	set: "readlist-preferences readlist-preferences--set",
};

const WIZARD_OPEN_CLASS = "readlist-preferences--wizard-open";

const READ_ONLY_CLASS = "readlist-preferences--read-only";

const WIZARD_HEADING: Record<PurposeState, WizardHeading> = {
	unset: { kind: "step" },
	set: { kind: "task", title: "Edit readlist purpose" },
};

interface PopoverControl {
	popoverId: string;
}

interface PanelControls {
	modifierClasses: readonly string[];
	setupActions: readonly PopoverControl[];
	editControls: readonly PopoverControl[];
	inlineWizards: readonly string[];
	wizardPopoverHtml: string;
	setupLocks: readonly string[];
	purposeLocks: readonly string[];
}

interface PanelControlsInput {
	wizard: WizardRender;
	wizardOpenClasses: readonly string[];
	state: PurposeState;
	offer: UpgradeOffer | undefined;
}

const PURPOSE_LOCKS: Record<PurposeState, (offer: UpgradeOffer | undefined) => Pick<PanelControls, "setupLocks" | "purposeLocks">> = {
	unset: (offer) => ({
		setupLocks: renderedLockFor({
			offer,
			gated: true,
			key: "set-up-readlist",
			label: "Set up readlist",
			controlClass: "btn btn--neutral readlist-empty__cta",
			source: PREFERENCES_SOURCE,
		}),
		purposeLocks: [],
	}),
	set: (offer) => ({
		setupLocks: [],
		purposeLocks: renderedLockFor({
			offer,
			gated: true,
			key: "edit-purpose",
			label: "Edit",
			controlClass: "btn btn--neutral btn--s",
			source: PREFERENCES_SOURCE,
		}),
	}),
};

const PANEL_CONTROLS: Record<PurposeState | "needs-upgrade" | "withheld", (input: PanelControlsInput) => PanelControls> = {
	unset: (input) => ({
		modifierClasses: input.wizardOpenClasses,
		setupActions: [{ popoverId: READLIST_PREFERENCES_WIZARD_ID }],
		editControls: [],
		inlineWizards: [input.wizard.inlineHtml],
		wizardPopoverHtml: input.wizard.popoverHtml,
		setupLocks: [],
		purposeLocks: [],
	}),
	set: (input) => ({
		modifierClasses: input.wizardOpenClasses,
		setupActions: [],
		editControls: [{ popoverId: READLIST_PREFERENCES_WIZARD_ID }],
		inlineWizards: [input.wizard.inlineHtml],
		wizardPopoverHtml: input.wizard.popoverHtml,
		setupLocks: [],
		purposeLocks: [],
	}),
	"needs-upgrade": (input) => ({
		modifierClasses: [READ_ONLY_CLASS],
		setupActions: [],
		editControls: [],
		inlineWizards: [],
		wizardPopoverHtml: "",
		...PURPOSE_LOCKS[input.state](input.offer),
	}),
	withheld: () => ({
		modifierClasses: [READ_ONLY_CLASS],
		setupActions: [],
		editControls: [],
		inlineWizards: [],
		wizardPopoverHtml: "",
		setupLocks: [],
		purposeLocks: [],
	}),
};

function purposeStateOf(readlist: { purpose?: string }): PurposeState {
	return readlist.purpose === undefined ? "unset" : "set";
}

export function renderReadlistPurposeWizard(input: {
	readlist: { slug: ReadlistSlug; purpose?: string };
	values: Partial<ReadlistPreferencesWizardViewModel>;
	error?: string;
}): WizardRender {
	const preferencesHref = readlistPreferencesPath(input.readlist.slug);
	const state = purposeStateOf(input.readlist);
	return renderWizard({
		id: READLIST_PREFERENCES_WIZARD_ID,
		key: READLIST_PREFERENCES_WIZARD_KEY,
		steps: READLIST_PREFERENCES_STEPS[state],
		values: input.values,
		action: withInternalTracking(preferencesHref, { source: PREFERENCES_SOURCE, content: "save-purpose" }),
		cancelHref: withInternalTracking(preferencesHref, { source: PREFERENCES_SOURCE, content: "cancel" }),
		submitLabel: "Save",
		heading: WIZARD_HEADING[state],
		failureMessage: PURPOSE_FAILURE_MESSAGE,
		error: input.error,
	});
}

export interface ReadlistPreferencesViewModel {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string; emailDelivery: EmailDeliveryMode };
	rail: ReadlistRailViewModel;
	values: Partial<ReadlistPreferencesWizardViewModel>;
	wizardOpen: boolean;
	purposeError?: string;
	inboxes: readonly InboxAddressEntry[];
	choices: ReadlistFitChoices;
	alert?: AlertContent;
	gmailSenders: ReadlistGmailSendersViewModel | undefined;
	accessIsReadOnly: boolean;
	subscriptionBanner: SubscriptionBannerState;
	onboarding: ReadlistOnboarding;
	query: Record<string, unknown>;
	cspNonce: CspNonce;
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
				activeSlug: vm.rail.activeReadlist.slug,
				newReadlistAction: vm.rail.newReadlistAction,
				limitAlertHref: vm.rail.limitAlertHref,
				canEdit: vm.rail.canEdit,
				canCreate: vm.rail.canCreate,
				offer: vm.rail.offer,
			}),
		),
		alertHtml: renderAlert({ key: "readlist", content: vm.alert ?? readlistAlertFor(vm.query) }),
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
		purposeText: vm.readlist.purpose,
		editControls: controls.editControls,
		purposeLocks: controls.purposeLocks,
		inlineWizards: controls.inlineWizards,
		inboxesHtml: renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: vm.readlist,
				inboxes: vm.inboxes,
				readlists: vm.rail.readlists,
			}),
		),
		gmailSendersHtml: vm.gmailSenders === undefined ? "" : renderReadlistGmailSenders(vm.gmailSenders),
		choicesHtml: renderReadlistFitChoices({
			readlist: vm.readlist,
			choices: vm.choices,
		}),
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
			GMAIL_SENDER_WIDGET_STYLES,
			READLIST_GMAIL_SENDERS_STYLES,
		].join("\n"),
		bodyClass: READLIST_BODY_CLASS,
		content: { html: content },
		scripts: readlistPageScripts(vm.cspNonce),
	};
}
