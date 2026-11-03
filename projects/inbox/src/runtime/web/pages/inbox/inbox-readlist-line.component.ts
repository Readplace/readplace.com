import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { ReadlistLineViewModel } from "./inbox-email-detail.viewmodel";

const INBOX_READLIST_LINE_TEMPLATE = readFileSync(
	join(__dirname, "inbox-readlist-line.template.html"),
	"utf-8",
);

export function renderInboxReadlistLine(vm: ReadlistLineViewModel): string {
	return render(INBOX_READLIST_LINE_TEMPLATE, vm);
}
