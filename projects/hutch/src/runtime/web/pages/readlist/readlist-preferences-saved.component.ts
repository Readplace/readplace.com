import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INBOX_MAX_LINKS_PER_EMAIL } from "@packages/domain/inbox";
import { render } from "@packages/web-shell";
import { PREFERENCES_SETUP_SAVED } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-preferences-saved.template.html"), "utf8");

export function renderPreferencesSaved(input: { label: string; purpose: string | undefined; query: Record<string, unknown> }): string {
	if (input.query[PREFERENCES_SETUP_SAVED] !== "1" || input.purpose === undefined) return "";
	return render(TEMPLATE, { readlist: input.label, limit: INBOX_MAX_LINKS_PER_EMAIL });
}
