import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_PURPOSE_MAX_LENGTH, type ReadlistSlug } from "@packages/domain/readlist";
import { render } from "@packages/web-shell";

import { GMAIL_PATH } from "../integrations/gmail.url";
import { readlistPreferencesPath } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-smart-filing.template.html"), "utf-8");

const NEWSLETTERS_PATH = "/inbox";

export type ReadlistFilingMode = "legacy" | "manual" | "smart";

export function readlistSmartRulePath(slug: ReadlistSlug): string {
	return `${readlistPreferencesPath(slug)}/smart`;
}

export function readlistSmartOffPath(slug: ReadlistSlug): string {
	return `${readlistPreferencesPath(slug)}/smart/off`;
}

export function renderReadlistSmartFiling(vm: {
	slug: ReadlistSlug;
	mode: ReadlistFilingMode;
	purpose: string | undefined;
	paidFeaturesLocked: boolean;
	error: string | undefined;
}): string {
	const smart = vm.mode === "smart";
	return render(TEMPLATE, {
		mode: vm.mode,
		smart,
		paused: smart && vm.paidFeaturesLocked,
		purpose: vm.purpose,
		error: vm.error,
		maxLength: READLIST_PURPOSE_MAX_LENGTH,
		ruleAction: readlistSmartRulePath(vm.slug),
		turnOffAction: readlistSmartOffPath(vm.slug),
		newslettersHref: NEWSLETTERS_PATH,
		gmailHref: GMAIL_PATH,
	});
}
