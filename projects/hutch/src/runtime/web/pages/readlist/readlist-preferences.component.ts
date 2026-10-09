import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderIllustration,
	withInternalTracking,
} from "@packages/web-shell";
import type { AlertContent, CspNonce, PageBody } from "@packages/web-shell";

import { ONBOARDING_STYLES } from "../../onboarding/onboarding.component";
import type { SaveTip } from "../../shared/save-tip/save-tip.component";
import { SUBSCRIBE_PLANS_STYLES } from "../../shared/subscribe-plans/subscribe-plans.component";
import { WIZARD_STYLES, type WizardRender, renderWizard } from "../../shared/wizard/wizard.component";
import type { WizardHeading } from "../../shared/wizard/wizard.types";
import { readlistAlertFor } from "./readlist-alerts";
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
import { preferencesUrl, purposeDeleteUrl } from "./readlist-preferences-feature";
import { READLIST_PREFERENCES_STYLES } from "./readlist-preferences.styles";
import {
	READLIST_PURPOSE_DELETE_ID,
	renderPurposeDeleteConfirm,
} from "./readlist-purpose-delete-confirm.component";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { renderReadlistSave, toReadlistSaveDisplayModel } from "./readlist-save.component";
import { readlistReturnQuery } from "./readlist.url";
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

interface SetupAction {
	popoverId: string;
}

interface PurposeMenuTrigger {
	iconName: IconName;
	text: string;
	popoverId: string;
	testAction: string;
}

interface PurposeMenuAction {
	iconName: IconName;
	text: string;
	url: string;
	testAction: string;
}

interface PurposeMenu {
	triggers: readonly PurposeMenuTrigger[];
	actions: readonly PurposeMenuAction[];
}

interface PanelControls {
	modifierClasses: readonly string[];
	setupActions: readonly SetupAction[];
	menus: readonly PurposeMenu[];
	inlineWizards: readonly string[];
	wizardPopoverHtml: string;
	purposeDeleteConfirmHtml: string;
}

interface PanelControlsInput {
	readlist: { slug: ReadlistSlug; label: string };
	preferencesEnabled: boolean;
	wizard: WizardRender;
	wizardOpenClasses: readonly string[];
}

function purposeMenu(input: PanelControlsInput): PurposeMenu {
	return {
		triggers: [
			{
				iconName: "pencil",
				text: "Edit",
				popoverId: READLIST_PREFERENCES_WIZARD_ID,
				testAction: "readlist-preferences-edit",
			},
			{
				iconName: "trash",
				text: "Delete",
				popoverId: READLIST_PURPOSE_DELETE_ID,
				testAction: "readlist-preferences-delete",
			},
		],
		actions: [
			{
				iconName: "trash",
				text: "Delete",
				url: withInternalTracking(
					purposeDeleteUrl({ slug: input.readlist.slug, enabled: input.preferencesEnabled }),
					{ source: PREFERENCES_SOURCE, content: "delete-purpose-fallback" },
				),
				testAction: "readlist-preferences-delete-fallback",
			},
		],
	};
}

const PANEL_CONTROLS: Record<PurposeState | "read-only", (input: PanelControlsInput) => PanelControls> = {
	unset: (input) => ({
		modifierClasses: input.wizardOpenClasses,
		setupActions: [{ popoverId: READLIST_PREFERENCES_WIZARD_ID }],
		menus: [],
		inlineWizards: [input.wizard.inlineHtml],
		wizardPopoverHtml: input.wizard.popoverHtml,
		purposeDeleteConfirmHtml: "",
	}),
	set: (input) => ({
		modifierClasses: input.wizardOpenClasses,
		setupActions: [],
		menus: [purposeMenu(input)],
		inlineWizards: [input.wizard.inlineHtml],
		wizardPopoverHtml: input.wizard.popoverHtml,
		purposeDeleteConfirmHtml: renderPurposeDeleteConfirm({
			label: input.readlist.label,
			action: withInternalTracking(
				purposeDeleteUrl({ slug: input.readlist.slug, enabled: input.preferencesEnabled }),
				{ source: PREFERENCES_SOURCE, content: "delete-purpose" },
			),
		}),
	}),
	"read-only": () => ({
		modifierClasses: [READ_ONLY_CLASS],
		setupActions: [],
		menus: [],
		inlineWizards: [],
		wizardPopoverHtml: "",
		purposeDeleteConfirmHtml: "",
	}),
};

function purposeStateOf(readlist: { purpose?: string }): PurposeState {
	return readlist.purpose === undefined ? "unset" : "set";
}

export function renderReadlistPurposeWizard(input: {
	readlist: { slug: ReadlistSlug; purpose?: string };
	preferencesEnabled: boolean;
	values: Partial<ReadlistPreferencesWizardViewModel>;
	error?: string;
}): WizardRender {
	const preferencesHref = preferencesUrl({
		slug: input.readlist.slug,
		enabled: input.preferencesEnabled,
	});
	return renderWizard({
		id: READLIST_PREFERENCES_WIZARD_ID,
		key: READLIST_PREFERENCES_WIZARD_KEY,
		steps: READLIST_PREFERENCES_STEPS,
		values: input.values,
		action: withInternalTracking(preferencesHref, { source: PREFERENCES_SOURCE, content: "save-purpose" }),
		cancelHref: withInternalTracking(preferencesHref, { source: PREFERENCES_SOURCE, content: "cancel" }),
		submitLabel: "Save",
		heading: WIZARD_HEADING[purposeStateOf(input.readlist)],
		failureMessage: PURPOSE_FAILURE_MESSAGE,
		error: input.error,
	});
}

export interface ReadlistPreferencesViewModel {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	rail: ReadlistRailViewModel;
	values: Partial<ReadlistPreferencesWizardViewModel>;
	wizardOpen: boolean;
	purposeError?: string;
	inboxes: readonly InboxAddressEntry[];
	inboxAlert?: AlertContent;
	preferencesEnabled: boolean;
	accessIsReadOnly: boolean;
	subscriptionBanner: SubscriptionBannerState;
	onboarding: ReadlistOnboarding;
	saveTip: SaveTip;
	query: Record<string, unknown>;
	cspNonce: CspNonce;
}

export function ReadlistPreferencesPage(vm: ReadlistPreferencesViewModel): PageBody {
	const state = purposeStateOf(vm.readlist);
	const controls = PANEL_CONTROLS[vm.accessIsReadOnly ? "read-only" : state]({
		readlist: vm.readlist,
		preferencesEnabled: vm.preferencesEnabled,
		wizard: renderReadlistPurposeWizard({
			readlist: vm.readlist,
			preferencesEnabled: vm.preferencesEnabled,
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
		subscribeSource: "queue-preferences-banner",
	});

	const content = render(TEMPLATE, {
		readlistNavHtml: renderReadlistNav(
			buildReadlistNav({
				readlists: vm.rail.readlists,
				activeSlug: vm.rail.activeReadlist.slug,
				newReadlistAction: vm.rail.newReadlistAction,
				canCreate: vm.rail.canCreate,
			}),
		),
		alertHtml: renderAlert({ key: "readlist", content: vm.inboxAlert ?? readlistAlertFor(vm.query) }),
		saveCardHtml: renderReadlistSave(
			toReadlistSaveDisplayModel({
				filters: { readlist: vm.readlist.slug, tab: "queue", page: 1 },
				accessIsReadOnly: vm.accessIsReadOnly,
				saveTipState: vm.saveTip.state,
			}),
		),
		tabsHtml: renderReadlistTabs(
			buildReadlistTabs({
				activeTab: "preferences",
				readlist: vm.readlist.slug,
				preferencesEnabled: vm.preferencesEnabled,
			}),
		),
		panelClass: [PANEL_CLASS[state], ...controls.modifierClasses].join(" "),
		state,
		readlistLabel: vm.readlist.label,
		setupIllustrationHtml: renderIllustration("book-lightbulb"),
		setupActions: controls.setupActions,
		purposeText: vm.readlist.purpose,
		menus: controls.menus,
		inlineWizards: controls.inlineWizards,
		inboxesHtml: renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: vm.readlist,
				inboxes: vm.inboxes,
				readlists: vm.rail.readlists,
				preferencesEnabled: vm.preferencesEnabled,
			}),
		),
		subscriptionHtml: side.subscriptionHtml,
		onboardingHtml: side.onboardingHtml,
		readlistRenamesHtml: panels.renames,
		readlistCreateHtml: panels.create,
		readlistDeleteConfirmHtml: panels.deleteConfirms,
		wizardPopoverHtml: controls.wizardPopoverHtml,
		purposeDeleteConfirmHtml: controls.purposeDeleteConfirmHtml,
		subscribePlansHtml: side.subscribePlansHtml,
		saveTipHtml: vm.saveTip.html,
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
			SUBSCRIBE_PLANS_STYLES,
			ONBOARDING_STYLES,
			READLIST_STYLES,
			WIZARD_STYLES,
			READLIST_PREFERENCES_STYLES,
		].join("\n"),
		bodyClass: READLIST_BODY_CLASS,
		content: { html: content },
		scripts: readlistPageScripts(vm.cspNonce),
	};
}
