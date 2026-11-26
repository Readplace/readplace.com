import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_PURPOSE_MAX_LENGTH } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { renderReadlistNameForm } from "./readlist-name-form.component";

export const READLIST_CREATE_POPOVER_ID = "readlist-create";

const SMART_TEMPLATE = readFileSync(join(__dirname, "readlist-create-smart.template.html"), "utf-8");

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

export interface ReadlistCreateSmartOption {
	checked: boolean;
	purpose: string;
}

export function readlistCreateAction(path: string): string {
	return withInternalTracking(path, { source: "queue-nav", content: "new-readlist" });
}

export function renderReadlistCreateForm(input: {
	popoverId: string;
	key: string;
	action: string;
	value: string;
	error?: string;
	hiddenFields: readonly { name: string; value: string }[];
	smart?: ReadlistCreateSmartOption;
}): string {
	const { smart } = input;
	return renderReadlistNameForm({
		key: input.key,
		popoverId: input.popoverId,
		action: input.action,
		inputId: `${input.popoverId}-name`,
		value: input.value,
		commitLabel: "Create readlist",
		failureMessage: "Couldn't create the readlist.",
		error: input.error,
		hiddenFields: input.hiddenFields,
		smart:
			smart === undefined
				? undefined
				: {
					fieldsHtml: render(SMART_TEMPLATE, {
						...smart,
						inputId: `${input.popoverId}-purpose`,
						maxLength: READLIST_PURPOSE_MAX_LENGTH,
					}),
					commitLabel: t("readlistSmart.create.submit"),
				},
	});
}

export function renderReadlistCreate(input: {
	popoverId: string;
	key: string;
	action: string;
	hiddenFields: readonly { name: string; value: string }[];
	smart?: ReadlistCreateSmartOption;
}): string {
	return renderConfirmPopover({
		id: input.popoverId,
		key: input.key,
		title: "Create a new readlist",
		body: "",
		actionsHtml: renderReadlistCreateForm({ ...input, value: "" }),
	});
}
