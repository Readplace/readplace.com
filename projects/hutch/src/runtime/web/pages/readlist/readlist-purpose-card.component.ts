import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadlistSlug } from "@packages/domain/readlist";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { render, truncateAtWordBoundary, withInternalTracking } from "@packages/web-shell";

import { type UpgradeOffer, type UpgradeStanding, renderedLockFor } from "../../shared/upgrade-offer/upgrade-offer";
import { type WizardRender, renderWizard } from "../../shared/wizard/wizard.component";
import type { WizardHeading } from "../../shared/wizard/wizard.types";
import {
	READLIST_PREFERENCES_STEPS,
	READLIST_PREFERENCES_WIZARD_ID,
	READLIST_PREFERENCES_WIZARD_KEY,
	type ReadlistPreferencesWizardViewModel,
} from "./readlist-preferences-wizard.component";
import { type PurposeOrigin, readlistPurposeActionPath, readlistPurposeLandingPath } from "./readlist.url";

export { READLIST_PURPOSE_CARD_STYLES } from "./readlist-purpose-card.styles";

const TEMPLATE = readFileSync(join(__dirname, "readlist-purpose-card.template.html"), "utf-8");

const PREFERENCES_SOURCE = "queue-preferences";

const PURPOSE_FAILURE_MESSAGE = "Couldn't save the purpose.";

export type PurposeState = "unset" | "set";

const WIZARD_HEADING: Record<PurposeState, WizardHeading> = {
	unset: { kind: "step" },
	set: { kind: "task", title: "Edit readlist purpose" },
};

export function purposeStateOf(readlist: { purpose?: string }): PurposeState {
	return readlist.purpose === undefined ? "unset" : "set";
}

export function renderReadlistPurposeWizard(input: {
	readlist: { slug: ReadlistSlug; purpose?: string };
	values: Partial<ReadlistPreferencesWizardViewModel>;
	from: PurposeOrigin;
	error?: string;
}): WizardRender {
	const target = { readlist: input.readlist.slug, from: input.from };
	const state = purposeStateOf(input.readlist);
	return renderWizard({
		id: READLIST_PREFERENCES_WIZARD_ID,
		key: READLIST_PREFERENCES_WIZARD_KEY,
		steps: READLIST_PREFERENCES_STEPS[state],
		values: input.values,
		action: withInternalTracking(readlistPurposeActionPath(target), { source: PREFERENCES_SOURCE, content: "save-purpose" }),
		cancelHref: withInternalTracking(readlistPurposeLandingPath(target), { source: PREFERENCES_SOURCE, content: "cancel" }),
		submitLabel: "Save",
		heading: WIZARD_HEADING[state],
		failureMessage: PURPOSE_FAILURE_MESSAGE,
		error: input.error,
	});
}

function previewOf(purpose: string): { preview: string; cut: boolean } {
	const flattened = purpose.replace(/\s+/g, " ").trim();
	const truncated = truncateAtWordBoundary(flattened, MAX_EXCERPT_LENGTH);
	return { preview: truncated.replace(/…$/u, ""), cut: truncated !== flattened };
}

const LOCKS: Record<UpgradeStanding, (offer: UpgradeOffer | undefined) => readonly string[]> = {
	open: () => [],
	"needs-upgrade": (offer) =>
		renderedLockFor({
			offer,
			gated: true,
			key: "edit-purpose",
			label: "Edit",
			controlClass: "btn btn--neutral btn--s",
			source: PREFERENCES_SOURCE,
		}),
	withheld: () => [],
};

export function renderReadlistPurposeCard(input: {
	purpose: string | undefined;
	standing: UpgradeStanding;
	offer: UpgradeOffer | undefined;
}): string {
	if (input.purpose === undefined) return "";
	return render(TEMPLATE, {
		editable: input.standing === "open",
		popoverId: READLIST_PREFERENCES_WIZARD_ID,
		purpose: input.purpose,
		locks: LOCKS[input.standing](input.offer),
		...previewOf(input.purpose),
	});
}

export function renderReadlistPurpose(input: {
	readlist: { slug: ReadlistSlug; purpose: string | undefined };
	standing: UpgradeStanding;
	offer: UpgradeOffer | undefined;
	from: PurposeOrigin;
}): { cardHtml: string; wizardPopoverHtml: string } {
	const { purpose } = input.readlist;
	const editable = purpose !== undefined && input.standing === "open";
	return {
		cardHtml: renderReadlistPurposeCard({ purpose, standing: input.standing, offer: input.offer }),
		wizardPopoverHtml: editable
			? renderReadlistPurposeWizard({
				readlist: { slug: input.readlist.slug, purpose },
				values: { purpose },
				from: input.from,
			}).popoverHtml
			: "",
	};
}
