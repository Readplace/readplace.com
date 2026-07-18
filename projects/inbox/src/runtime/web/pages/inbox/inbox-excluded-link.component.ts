import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { ExcludedLinkViewModel } from "./inbox-email-detail.viewmodel";

const INBOX_EXCLUDED_LINK_TEMPLATE = readFileSync(
	join(__dirname, "inbox-excluded-link.template.html"),
	"utf-8",
);

export function renderInboxExcludedLink(vm: ExcludedLinkViewModel): string {
	return render(INBOX_EXCLUDED_LINK_TEMPLATE, vm);
}
