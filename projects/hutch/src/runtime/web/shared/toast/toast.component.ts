import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../render";

export interface ToastAction {
	method: string;
	url: string;
	label: string;
	fields: ReadonlyArray<{ name: string; value: string }>;
}

export interface ToastViewModel {
	message: string;
	/** Milliseconds the toast stays before the global dismiss script removes it.
	 * Surfaced as the data-dismiss attribute so the behaviour is data-driven and
	 * shared by every toast, not re-implemented per page. */
	dismissMs: number;
	actions: ReadonlyArray<ToastAction>;
}

const TEMPLATE = readFileSync(join(__dirname, "toast.template.html"), "utf-8");

export function renderToast(toast: ToastViewModel): string {
	return render(TEMPLATE, toast);
}
