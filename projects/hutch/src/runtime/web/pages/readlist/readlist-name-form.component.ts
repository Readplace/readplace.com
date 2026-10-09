import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { render, renderInFlightDots } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "readlist-name-form.template.html"), "utf-8");

export const READLIST_NAME_FIELD = "label";

export const READLIST_NAME_LABEL = "Readlist name";

export const READLIST_NAME_PLACEHOLDER = "Enter readlist name";

export const READLIST_CLIENT_SCRIPT =
	'<script src="/client-dist/readlist.client.js" defer></script>';

const LOADER_HTML = renderInFlightDots("readlist-name-form__loader in-flight-dots");

export function renderReadlistNameForm(input: {
	key: string;
	popoverId: string;
	action: string;
	inputId: string;
	value: string;
	commitLabel: string;
	failureMessage: string;
}): string {
	return render(TEMPLATE, {
		...input,
		field: READLIST_NAME_FIELD,
		fieldLabel: READLIST_NAME_LABEL,
		placeholder: READLIST_NAME_PLACEHOLDER,
		maxLength: READLIST_LABEL_MAX_LENGTH,
		loaderHtml: LOADER_HTML,
	});
}
