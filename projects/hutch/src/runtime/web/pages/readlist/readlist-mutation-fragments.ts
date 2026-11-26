import { render, renderToast, withInternalTracking } from "@packages/web-shell";
import type { StatusFlash } from "./readlist.error";
import type { ReadlistUrlState } from "./readlist.url";
import { buildReadlistCountsUrl, readlistReturnQuery } from "./readlist.url";

/** Long enough to read the message and reach for Undo, short enough not to
 * linger; the global toast.client script removes it after this delay. */
export const STATUS_TOAST_DISMISS_MS = 6000;

interface StatusToastModel {
	message: string;
	undoUrl: string;
	undoStatus: "read" | "unread";
}

export function renderStatusToast(toast: StatusToastModel): string {
	return renderToast({
		message: toast.message,
		dismissMs: STATUS_TOAST_DISMISS_MS,
		actions: [
			{
				method: "POST",
				url: withInternalTracking(toast.undoUrl, { source: "queue-toast", content: "undo" }),
				label: "Undo",
				fields: [{ name: "status", value: toast.undoStatus }],
			},
		],
	});
}

export type MoveUndoFields = { from: string; to: string } | { queue: readonly string[]; returnTo: string };

interface MoveToastModel {
	message: string;
	undoUrl: string;
	undoFields: MoveUndoFields;
}

function moveUndoFields(fields: MoveUndoFields): { name: string; value: string }[] {
	if ("queue" in fields) {
		return [
			...fields.queue.map((queue) => ({ name: "queue", value: queue })),
			{ name: "returnTo", value: fields.returnTo },
		];
	}
	return [
		{ name: "from", value: fields.from },
		{ name: "to", value: fields.to },
	];
}

export function renderMoveToast(toast: MoveToastModel): string {
	return renderToast({
		message: toast.message,
		dismissMs: STATUS_TOAST_DISMISS_MS,
		actions: [
			{
				method: "POST",
				url: withInternalTracking(toast.undoUrl, { source: "queue-toast", content: "undo-move" }),
				label: "Undo",
				fields: moveUndoFields(toast.undoFields),
			},
		],
	});
}

export interface FilingToast {
	message: string;
	undoUrl: string;
	undoFields: { queue: readonly string[]; returnTo: string };
}

export function renderFilingToast(toast: FilingToast): string {
	return renderToast({
		message: toast.message,
		dismissMs: STATUS_TOAST_DISMISS_MS,
		actions: [
			{
				method: "POST",
				url: withInternalTracking(toast.undoUrl, { source: "reader-toast", content: "undo-filing" }),
				label: "Undo",
				fields: [
					...toast.undoFields.queue.map((queue) => ({ name: "queue", value: queue })),
					{ name: "returnTo", value: toast.undoFields.returnTo },
				],
			},
		],
	});
}

export function renderStatusToastMountOob(toastHtml: string): string {
	return `<div id="status-toast" hx-swap-oob="outerHTML">${toastHtml}</div>`;
}

/** The readlist's out-of-band counts loader. The readlist page renders it inert
 * (`oob` false); the mutation response re-arms an identical span carrying
 * `hx-swap-oob` so htmx re-fires its `load` trigger and the badge/page-count
 * refresh off the mutation's critical path via GET /queue/counts. Sharing one
 * renderer keeps the two copies from drifting. */
const COUNTS_TRIGGER_TEMPLATE =
	`<span id="readlist-counts" data-background-request hx-get="{{countsUrl}}" hx-trigger="load" hx-swap="none" data-test-readlist-counts{{#if oob}} hx-swap-oob="outerHTML"{{/if}}></span>`;

export function renderReadlistCountsTrigger(input: { countsUrl: string; oob?: boolean }): string {
	return render(COUNTS_TRIGGER_TEMPLATE, input);
}

/** The out-of-band body a card status change answers with: a re-armed counts
 * span plus the confirmation toast swapped into the stable `#status-toast`
 * mount. The primary body is left empty so the card form's `outerHTML` swap
 * removes the card. `statusFlash` is required — this fragment is reached only
 * once the change applied, so a card mutation always carries its toast. */
export function renderReadlistMutationFragment(input: {
	filters: ReadlistUrlState;
	statusFlash: StatusFlash;
}): string {
	const counts = renderReadlistCountsTrigger({
		countsUrl: buildReadlistCountsUrl(input.filters),
		oob: true,
	});
	const returnQuery = readlistReturnQuery(input.filters);
	const toast = renderStatusToast({
		message: input.statusFlash.message,
		undoUrl: `/queue/${input.statusFlash.undoArticleId}/status${returnQuery}`,
		undoStatus: input.statusFlash.undoStatus,
	});
	return `${renderStatusToastMountOob(toast)}${counts}`;
}
