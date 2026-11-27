import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_PURPOSE_MAX_LENGTH, type ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render } from "@packages/web-shell";

import { type UpgradeOffer, type UpgradeStanding, renderedLockFor } from "../../shared/upgrade-offer/upgrade-offer";
import { GMAIL_PATH } from "../integrations/gmail.url";
import { READLIST_SMART_SECTION_ID, readlistPreferencesPath } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-smart-filing.template.html"), "utf-8");

const NEWSLETTERS_PATH = "/inbox";

export type ReadlistFilingMode = "legacy" | "manual" | "smart";

export function readlistSmartRulePath(slug: ReadlistSlug): string {
	return `${readlistPreferencesPath(slug)}/smart`;
}

export function readlistSmartOffPath(slug: ReadlistSlug): string {
	return `${readlistPreferencesPath(slug)}/smart/off`;
}

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

const CONVERT_LOCKS: Record<UpgradeStanding, (offer: UpgradeOffer | undefined) => readonly string[]> = {
	open: () => [],
	"needs-upgrade": (offer) =>
		renderedLockFor({
			offer,
			gated: true,
			key: "make-smart-readlist",
			label: t("readlistSmart.convert.submit"),
			controlClass: "btn btn--primary btn--m",
			source: "queue-preferences",
		}),
	withheld: () => [],
};

export function renderReadlistSmartFiling(vm: {
	slug: ReadlistSlug;
	mode: ReadlistFilingMode;
	standing: UpgradeStanding;
	offer: UpgradeOffer | undefined;
	error: string | undefined;
}): string {
	const smart = vm.mode === "smart";
	return render(TEMPLATE, {
		sectionId: READLIST_SMART_SECTION_ID,
		mode: vm.mode,
		smart,
		paused: smart && vm.standing !== "open",
		convertForm: vm.standing === "open",
		convertLocks: CONVERT_LOCKS[vm.standing](vm.offer),
		error: vm.error,
		maxLength: READLIST_PURPOSE_MAX_LENGTH,
		ruleAction: readlistSmartRulePath(vm.slug),
		turnOffAction: readlistSmartOffPath(vm.slug),
		newslettersHref: NEWSLETTERS_PATH,
		gmailHref: GMAIL_PATH,
	});
}
