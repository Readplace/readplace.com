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
	type HighlightFormTarget,
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

const LOCAL_DELETE_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="dialog" data-highlight-local="delete" data-highlight-local-id="{{highlightId}}">
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
	openNote: HighlightId | undefined;
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

export function highlightDeletePopoverId(highlightId: HighlightId): string {
	return `delete-highlight-${highlightId}`;
}

function byOrder(a: HighlightsRailRow, b: HighlightsRailRow): number {
	const order = a.highlight.orderKey - b.highlight.orderKey;
	return order !== 0
		? order
		: a.highlight.highlightId.localeCompare(b.highlight.highlightId);
}

function highlightDeleteUrl(input: { highlightId: HighlightId; scope: HighlightFormScope }): string {
	return highlightFormUrl({
		scope: input.scope,
		path: `/highlights/${input.highlightId}/delete`,
		source: "highlights-rail",
		content: "delete-highlight",
	});
}

function deleteConfirmActions(input: { highlightId: HighlightId; target: HighlightFormTarget }): string {
	const { highlightId, target } = input;
	if (target.kind === "local") return render(LOCAL_DELETE_ACTIONS_TEMPLATE, { highlightId });
	return render(DELETE_ACTIONS_TEMPLATE, {
		url: highlightDeleteUrl({ highlightId, scope: target.scope }),
		pushesHistory: pushesHistory(target.scope),
	});
}

export function renderHighlightDeleteConfirm(input: {
	highlightId: HighlightId;
	note: string | undefined;
	target: HighlightFormTarget;
}): string {
	return renderConfirmPopover({
		id: highlightDeletePopoverId(input.highlightId),
		key: "highlight-delete",
		subject: input.highlightId,
		close: {},
		title: t("articleBody.highlightsRail.deleteConfirm.title"),
		body:
			input.note === undefined
				? t("articleBody.highlightsRail.deleteConfirm.body")
				: t("articleBody.highlightsRail.deleteConfirm.bodyWithNote"),
		actionsHtml: deleteConfirmActions(input),
	});
}

function editView(input: {
	highlight: Highlight;
	quote: string;
	scope: HighlightFormScope;
	noteOpen: boolean;
}) {
	const { highlight } = input;
	const target: HighlightFormTarget = { kind: "server", scope: input.scope };
	const noteInput = {
		highlightId: highlight.highlightId,
		note: highlight.note,
	};
	return {
		deleteUrl: highlightDeleteUrl({ highlightId: highlight.highlightId, scope: input.scope }),
		pushesHistory: pushesHistory(input.scope),
		popoverId: highlightDeletePopoverId(highlight.highlightId),
		noteLabel:
			highlight.note === undefined
				? t("articleBody.highlightsRail.addNote")
				: t("articleBody.highlightsRail.editNote"),
		notePopoverId: highlightNoteEditPopoverId(highlight.highlightId),
		noteDialogHtml: renderHighlightNoteEditDialog({ ...noteInput, quote: input.quote, target }),
		noteOpen: input.noteOpen,
		noteFallbackHtml: renderHighlightNoteFallbackForm({ ...noteInput, scope: input.scope, open: input.noteOpen }),
		noteDeleteHtml:
			highlight.note === undefined
				? undefined
				: renderHighlightNoteDeleteForm({ highlightId: highlight.highlightId, target }),
		popoverHtml: renderHighlightDeleteConfirm({ ...noteInput, target }),
	};
}

function rowView(input: {
	row: HighlightsRailRow;
	scope: HighlightFormScope | undefined;
	openNote: HighlightId | undefined;
}) {
	const { highlight, shown, marked } = input.row;
	return {
		highlightId: highlight.highlightId,
		quote: shown.quote,
		state: shown.state,
		marked,
		edited: shown.edited
			? t("articleBody.highlightsRail.edited", { quote: highlight.exact })
			: undefined,
		orphaned: shown.state === "orphaned",
		jumpHref: marked
			? `#${ARTICLE_HIGHLIGHT_ID_PREFIX}${highlight.highlightId}`
			: "",
		note: highlight.note,
		edit:
			input.scope === undefined
				? undefined
				: editView({
						highlight,
						quote: shown.quote,
						scope: input.scope,
						noteOpen: highlight.highlightId === input.openNote,
					}),
	};
}

export type HighlightsRailRowView = ReturnType<typeof rowView>;

export function highlightsRailRowViews(input: {
	rows: readonly HighlightsRailRow[];
	scope: HighlightFormScope | undefined;
	openNote: HighlightId | undefined;
}): HighlightsRailRowView[] {
	return [...input.rows]
		.sort(byOrder)
		.map((row) => rowView({ row, scope: input.scope, openNote: input.openNote }));
}

export function renderHighlightsRail(
	input: HighlightsRailInput,
): RenderedHighlightsRail {
	const rows = highlightsRailRowViews(input);
	return {
		html: render(HIGHLIGHTS_RAIL_TEMPLATE, { rows, oob: input.oob }).trim(),
		hasRows: rows.length > 0,
	};
}
