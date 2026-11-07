import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIGHLIGHT_NOTE_MAX_LENGTH } from "@packages/domain/article";
import { render, renderInFlightDots } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "highlight-note-form.template.html"),
	"utf-8",
);

export const HIGHLIGHT_NOTE_FIELD = "note";

export const HIGHLIGHT_NOTE_LABEL = "Note";

export const HIGHLIGHT_NOTE_FAILURE = "Couldn't save the note. Try again.";

export type HighlightNoteRefusal = "passage";

const LOADER_HTML = renderInFlightDots(
	"readlist-name-form__loader in-flight-dots",
);

export function renderHighlightNoteForm(input: {
	popoverId?: string;
	key: string;
	inputId: string;
	action: string;
	value: string;
	error?: string;
	refusal?: HighlightNoteRefusal;
	hiddenFields: readonly { name: string; value: string }[];
	answersInPlace: boolean;
	autofocus: boolean;
}): string {
	return render(TEMPLATE, {
		...input,
		field: HIGHLIGHT_NOTE_FIELD,
		fieldLabel: HIGHLIGHT_NOTE_LABEL,
		maxLength: HIGHLIGHT_NOTE_MAX_LENGTH,
		failureMessage: HIGHLIGHT_NOTE_FAILURE,
		commitLabel: "Save note",
		loaderHtml: LOADER_HTML,
	}).trim();
}
