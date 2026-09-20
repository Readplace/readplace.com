import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

import type { ReadlistAlert } from "./readlist-alerts";

const TEMPLATE = readFileSync(join(__dirname, "readlist-alert.template.html"), "utf-8");

export function renderReadlistAlert(alert: ReadlistAlert | undefined): string {
	return render(TEMPLATE, {
		stateClass: alert ? "readlist__alert--visible" : "readlist__alert--hidden",
		title: alert?.title ?? "",
		body: alert?.body ?? "",
	});
}
