import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadlistSlug } from "@packages/domain/readlist";
import { CONFIRM_POPOVER_STYLES, render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { WIZARD_STYLES, renderWizard } from "../../shared/wizard/wizard.component";
import { renderReadlistAlert } from "./readlist-alert.component";
import { readlistAlertFor } from "./readlist-alerts";
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
	READLIST_PAGE_SCRIPTS,
	readlistPanels,
} from "./readlist.component";
import { READLIST_STYLES } from "./readlist.styles";
import {
	READLIST_PREFERENCES_STEPS,
	READLIST_PREFERENCES_WIZARD_ID,
	READLIST_PREFERENCES_WIZARD_KEY,
	type ReadlistPreferencesWizardViewModel,
} from "./readlist-preferences-wizard.component";
import { preferencesFeatureParams, preferencesUrl } from "./readlist-preferences-feature";
import { READLIST_PREFERENCES_STYLES } from "./readlist-preferences.styles";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { buildReadlistUrl } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-preferences.template.html"), "utf-8");

const PREFERENCES_SOURCE = "queue-preferences";

const PANEL_CLASS: Record<"unset" | "set", string> = {
	unset: "readlist-preferences readlist-preferences--unset",
	set: "readlist-preferences readlist-preferences--set",
};

const WIZARD_OPEN_CLASS = "readlist-preferences--wizard-open";

export interface ReadlistPreferencesViewModel {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	rail: ReadlistRailViewModel;
	values: Partial<ReadlistPreferencesWizardViewModel>;
	wizardOpen: boolean;
	purposeError?: string;
	preferencesEnabled: boolean;
	query: Record<string, unknown>;
}

export function ReadlistPreferencesPage(vm: ReadlistPreferencesViewModel): PageBody {
	const state = vm.readlist.purpose === undefined ? "unset" : "set";
	const wizard = renderWizard({
		id: READLIST_PREFERENCES_WIZARD_ID,
		key: READLIST_PREFERENCES_WIZARD_KEY,
		steps: READLIST_PREFERENCES_STEPS,
		values: vm.values,
		action: withInternalTracking(
			preferencesUrl({ slug: vm.readlist.slug, enabled: vm.preferencesEnabled }),
			{ source: PREFERENCES_SOURCE, content: "save-purpose" },
		),
		cancelHref: withInternalTracking(
			buildReadlistUrl(
				{ readlist: vm.readlist.slug },
				preferencesFeatureParams(vm.preferencesEnabled),
			),
			{ source: PREFERENCES_SOURCE, content: "cancel" },
		),
		submitLabel: "Save",
		error: vm.purposeError,
	});

	const panels = readlistPanels(vm.rail);
	const content = render(TEMPLATE, {
		readlistNavHtml: renderReadlistNav(
			buildReadlistNav({
				readlists: vm.rail.readlists,
				activeSlug: vm.rail.activeReadlist.slug,
				newReadlistAction: vm.rail.newReadlistAction,
				canCreate: vm.rail.canCreate,
			}),
		),
		alertHtml: renderReadlistAlert(readlistAlertFor(vm.query)),
		tabsHtml: renderReadlistTabs(
			buildReadlistTabs({
				activeTab: "preferences",
				readlist: vm.readlist.slug,
				preferencesEnabled: vm.preferencesEnabled,
			}),
		),
		readlistRenamesHtml: panels.renames,
		readlistDeleteConfirmHtml: panels.deleteConfirms,
		panelClass: `${PANEL_CLASS[state]}${vm.wizardOpen ? ` ${WIZARD_OPEN_CLASS}` : ""}`,
		state,
		readlistLabel: vm.readlist.label,
		setupLabel: `Set up ${vm.readlist.label}`,
		purposeText: vm.readlist.purpose,
		wizardPopoverId: READLIST_PREFERENCES_WIZARD_ID,
		wizardInlineHtml: wizard.inlineHtml,
		wizardPopoverHtml: wizard.popoverHtml,
	});

	return {
		seo: {
			title: `${vm.readlist.label} — Readplace`,
			description: "Your saved articles readlist.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: `${CONFIRM_POPOVER_STYLES}\n${READLIST_STYLES}\n${WIZARD_STYLES}\n${READLIST_PREFERENCES_STYLES}`,
		bodyClass: READLIST_BODY_CLASS,
		content: { html: content },
		scripts: READLIST_PAGE_SCRIPTS,
	};
}
