import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AnchorState,
	ARTICLE_HIGHLIGHT_ID_PREFIX,
	type Highlight,
	type HighlightId,
} from "@packages/domain/article";
import { render, renderConfirmPopover } from "@packages/web-shell";
import {
	highlightNoteEditPopoverId,
	renderHighlightNoteEditDialog,
	renderHighlightNoteFallbackForm,
} from "../highlights/highlight-note-dialog.component";
import type { ReaderHighlightState } from "../reader-slot/mark-highlights";

const HIGHLIGHTS_RAIL_TEMPLATE = readFileSync(
	join(__dirname, "highlights-rail.template.html"),
	"utf-8",
);

const DELETE_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none" hx-disabled-elt="find button">
	<button class="btn btn--primary" type="submit" data-test-action="highlight-delete-confirm" autofocus>Delete</button>
</form>`;

export type HighlightsRailRowState = AnchorState | "pending";

export interface HighlightsRailRow {
	highlight: Highlight;
	state: HighlightsRailRowState;
}

export interface HighlightsRailInput {
	rows: readonly HighlightsRailRow[];
	deleteUrlFor: (highlightId: HighlightId) => string;
	noteUrlFor: (highlightId: HighlightId) => string;
	oob: boolean;
}

export interface RenderedHighlightsRail {
	html: string;
	hasRows: boolean;
}

export function highlightsRailRowsFromStates(
	states: readonly ReaderHighlightState[],
): HighlightsRailRow[] {
	return states.map(({ highlight, anchor }) => ({
		highlight,
		state: anchor.anchorState,
	}));
}

export function pendingHighlightsRailRows(
	highlights: readonly Highlight[],
): HighlightsRailRow[] {
	return highlights.map((highlight) => ({ highlight, state: "pending" }));
}

function deletePopoverId(highlightId: HighlightId): string {
	return `delete-highlight-${highlightId}`;
}

function byOrder(a: HighlightsRailRow, b: HighlightsRailRow): number {
	const order = a.highlight.orderKey - b.highlight.orderKey;
	return order !== 0
		? order
		: a.highlight.highlightId.localeCompare(b.highlight.highlightId);
}

function rowView(input: {
	row: HighlightsRailRow;
	deleteUrlFor: HighlightsRailInput["deleteUrlFor"];
	noteUrlFor: HighlightsRailInput["noteUrlFor"];
}) {
	const { highlight, state } = input.row;
	const popoverId = deletePopoverId(highlight.highlightId);
	const deleteUrl = input.deleteUrlFor(highlight.highlightId);
	const noteAction = input.noteUrlFor(highlight.highlightId);
	const noteInput = {
		highlightId: highlight.highlightId,
		note: highlight.note,
		action: noteAction,
	};
	const markable = state === "anchored" || state === "moved";
	return {
		highlightId: highlight.highlightId,
		exact: highlight.exact,
		state,
		orphaned: state === "orphaned",
		jumpHref: markable
			? `#${ARTICLE_HIGHLIGHT_ID_PREFIX}${highlight.highlightId}`
			: "",
		deleteUrl,
		popoverId,
		note: highlight.note,
		noteLabel: highlight.note === undefined ? "Add note" : "Edit note",
		notePopoverId: highlightNoteEditPopoverId(highlight.highlightId),
		noteDialogHtml: renderHighlightNoteEditDialog(noteInput),
		noteFallbackHtml: renderHighlightNoteFallbackForm(noteInput),
		popoverHtml: renderConfirmPopover({
			id: popoverId,
			key: "highlight-delete",
			subject: highlight.highlightId,
			close: {},
			title: "Delete this highlight?",
			body: "The passage stays in the article; only your highlight is removed.",
			actionsHtml: render(DELETE_ACTIONS_TEMPLATE, { url: deleteUrl }),
		}),
	};
}

export function renderHighlightsRail(
	input: HighlightsRailInput,
): RenderedHighlightsRail {
	const rows = [...input.rows]
		.sort(byOrder)
		.map((row) =>
			rowView({
				row,
				deleteUrlFor: input.deleteUrlFor,
				noteUrlFor: input.noteUrlFor,
			}),
		);
	return {
		html: render(HIGHLIGHTS_RAIL_TEMPLATE, { rows, oob: input.oob }).trim(),
		hasRows: rows.length > 0,
	};
}
