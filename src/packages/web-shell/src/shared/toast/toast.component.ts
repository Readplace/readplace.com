import { render } from "../../render";
import { TOAST_TEMPLATE } from "./toast.template";

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

export function renderToast(toast: ToastViewModel): string {
	return render(TOAST_TEMPLATE, toast);
}
