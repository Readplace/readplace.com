import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ARTICLE_HIGHLIGHT_ID_PREFIX,
	type Highlight,
	type HighlightId,
	type StoredHighlightState,
	storedHighlightState,
} from "@packages/domain/article";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render, renderConfirmPopover } from "@packages/web-shell";
import {
	type HighlightFormScope,
	highlightFormUrl,
	highlightNoteEditPopoverId,
	pushesHistory,
	renderHighlightNoteDeleteForm,
	renderHighlightNoteEditDialog,
	renderHighlightNoteFallbackForm,
} from "../highlights/highlight-note-dialog.component";
import type { ReaderHighlights, ReaderHighlightState } from "../reader-slot/mark-highlights";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const HIGHLIGHTS_RAIL_TEMPLATE = readFileSync(
	join(__dirname, "highlights-rail.template.html"),
	"utf-8",
);

const DELETE_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none"{{#unless pushesHistory}} hx-push-url="false"{{/unless}} hx-disabled-elt="find button">
	<button class="btn btn--primary" type="submit" data-test-action="highlight-delete-confirm" autofocus>{{t "articleBody.highlightsRail.deleteHighlight"}}</button>
</form>`;

export interface HighlightsRailRow {
	highlight: Highlight;
	shown: StoredHighlightState;
	marked: boolean;
}

export interface HighlightsRailInput {
	rows: readonly HighlightsRailRow[];
	scope: HighlightFormScope | undefined;
	oob: boolean;
}

export interface RenderedHighlightsRail {
	html: string;
	hasRows: boolean;
}

export function highlightsRailRowsFromStates(
	states: readonly ReaderHighlightState[],
): HighlightsRailRow[] {
	return states.map(({ highlight, place, shown }) => ({
		highlight,
		shown,
		marked: place !== undefined,
	}));
}

export function storedHighlightsRailRows(
	highlights: ReaderHighlights,
): HighlightsRailRow[] {
	return highlights.rows.map((highlight) => ({
		highlight,
		shown: storedHighlightState({
			highlight,
			contentHash: highlights.canonicalContentHash,
		}),
		marked: false,
	}));
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

function editView(input: { highlight: Highlight; scope: HighlightFormScope }) {
	const { highlight } = input;
	const popoverId = deletePopoverId(highlight.highlightId);
	const deleteUrl = highlightFormUrl({
		scope: input.scope,
		path: `/highlights/${highlight.highlightId}/delete`,
		source: "highlights-rail",
		content: "delete-highlight",
	});
	const pushes = pushesHistory(input.scope);
	const noteInput = {
		highlightId: highlight.highlightId,
		note: highlight.note,
		scope: input.scope,
	};
	return {
		deleteUrl,
		pushesHistory: pushes,
		popoverId,
		noteLabel:
			highlight.note === undefined
				? t("articleBody.highlightsRail.addNote")
				: t("articleBody.highlightsRail.editNote"),
		notePopoverId: highlightNoteEditPopoverId(highlight.highlightId),
		noteDialogHtml: renderHighlightNoteEditDialog(noteInput),
		noteFallbackHtml: renderHighlightNoteFallbackForm(noteInput),
		noteDeleteHtml:
			highlight.note === undefined
				? undefined
				: renderHighlightNoteDeleteForm(noteInput),
		popoverHtml: renderConfirmPopover({
			id: popoverId,
			key: "highlight-delete",
			subject: highlight.highlightId,
			close: {},
			title: t("articleBody.highlightsRail.deleteConfirm.title"),
			body:
				highlight.note === undefined
					? t("articleBody.highlightsRail.deleteConfirm.body")
					: t("articleBody.highlightsRail.deleteConfirm.bodyWithNote"),
			actionsHtml: render(DELETE_ACTIONS_TEMPLATE, {
				url: deleteUrl,
				pushesHistory: pushes,
			}),
		}),
	};
}

function rowView(input: { row: HighlightsRailRow; scope: HighlightFormScope | undefined }) {
	const { highlight, shown, marked } = input.row;
	return {
		highlightId: highlight.highlightId,
		quote: shown.quote,
		state: shown.state,
		edited: shown.edited
			? t("articleBody.highlightsRail.edited", { quote: highlight.exact })
			: undefined,
		orphaned: shown.state === "orphaned",
		jumpHref: marked
			? `#${ARTICLE_HIGHLIGHT_ID_PREFIX}${highlight.highlightId}`
			: "",
		note: highlight.note,
		edit: input.scope === undefined ? undefined : editView({ highlight, scope: input.scope }),
	};
}

export function renderHighlightsRail(
	input: HighlightsRailInput,
): RenderedHighlightsRail {
	const rows = [...input.rows]
		.sort(byOrder)
		.map((row) => rowView({ row, scope: input.scope }));
	return {
		html: render(HIGHLIGHTS_RAIL_TEMPLATE, { rows, oob: input.oob }).trim(),
		hasRows: rows.length > 0,
	};
}
