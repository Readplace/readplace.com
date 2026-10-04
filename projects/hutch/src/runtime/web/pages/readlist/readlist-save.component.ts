import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, withInternalTracking } from "@packages/web-shell";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import { DEFAULT_READLIST } from "./readlist.nav";
import { READLIST_SAVE_PATH, readlistReturnQuery, type ReadlistUrlState } from "./readlist.url";
import type { ReadlistViewModel } from "./readlist.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-save.template.html"), "utf-8");
const SKIPPED_TEMPLATE = readFileSync(join(__dirname, "readlist-save-skipped.template.html"), "utf-8");

interface FieldMessage {
	className: string;
	attributes: { name: string; value: string }[];
	text: string;
}

export interface ReadlistSaveDisplayModel {
	saveInputInvalid: boolean;
	fieldMessages: FieldMessage[];
	saveAction: string;
	saveUrl?: string;
	saveTipState: SaveTipState;
	accessIsReadOnly: boolean;
	skippedCalloutHtml: string;
}

export function toReadlistSaveDisplayModel(input: Pick<
	ReadlistViewModel,
	"errors" | "saveErrorCode" | "importFlash" | "importSkipped" | "accessIsReadOnly"
> & {
	filters: ReadlistUrlState;
	saveTipState: SaveTipState;
	saveUrl?: string;
}): ReadlistSaveDisplayModel {
	const saveError = input.errors?.[0]?.message;
	let fieldMessage: FieldMessage | undefined;
	if (saveError) {
		const attributes = [
			{ name: "id", value: "readlist-save-error" },
			{ name: "role", value: "alert" },
			{ name: "data-test-save-error", value: "" },
		];
		if (input.saveErrorCode) attributes.push({ name: "data-test-saveable-url-code", value: input.saveErrorCode });
		fieldMessage = {
			className: "form-field__error readlist-save__error",
			attributes,
			text: saveError,
		};
	} else if (input.importFlash) {
		fieldMessage = {
			className: "form-field__message",
			attributes: [{ name: "data-test-import-flash", value: "" }],
			text: input.importFlash,
		};
	}

	const skipped = input.importSkipped;
	const skippedCalloutHtml = skipped && skipped.entries.length > 0
		? renderAlert({
			key: "import-skipped",
			content: {
				variant: "error",
				title: { text: "Some links couldn't be imported", element: "p" },
				message: { html: render(SKIPPED_TEMPLATE, skipped) },
			},
		})
		: "";

	return {
		saveInputInvalid: Boolean(saveError),
		fieldMessages: fieldMessage ? [fieldMessage] : [],
		saveAction: withInternalTracking(
			`${READLIST_SAVE_PATH}${readlistReturnQuery({ ...input.filters, readlist: DEFAULT_READLIST.slug })}`,
			{ source: "queue", content: "save" },
		),
		saveUrl: input.saveUrl,
		saveTipState: input.saveTipState,
		accessIsReadOnly: input.accessIsReadOnly,
		skippedCalloutHtml,
	};
}

export function renderReadlistSave(displayModel: ReadlistSaveDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
