import { render, renderToast, withInternalTracking } from "@packages/web-shell";
import type { StatusFlash } from "./readlist.error";
import type { LinkParams, ReadlistUrlState } from "./readlist.url";
import { buildReadlistCountsUrl, readlistReturnQuery } from "./readlist.url";

/** Long enough to read the message and reach for Undo, short enough not to
 * linger; the global toast.client script removes it after this delay. */
const STATUS_TOAST_DISMISS_MS = 6000;

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

/** The readlist's out-of-band counts loader. The readlist page renders it inert
 * (`oob` false); the mutation response re-arms an identical span carrying
 * `hx-swap-oob` so htmx re-fires its `load` trigger and the badge/page-count
 * refresh off the mutation's critical path via GET /queue/counts. Sharing one
 * renderer keeps the two copies from drifting. */
const COUNTS_TRIGGER_TEMPLATE =
	`<span id="readlist-counts" hx-get="{{countsUrl}}" hx-trigger="load" hx-swap="none" data-test-readlist-counts{{#if oob}} hx-swap-oob="outerHTML"{{/if}}></span>`;

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
	linkParams?: LinkParams;
}): string {
	const counts = renderReadlistCountsTrigger({
		countsUrl: buildReadlistCountsUrl(input.filters, input.linkParams),
		oob: true,
	});
	const toast = renderStatusToast({
		message: input.statusFlash.message,
		undoUrl: `/queue/${input.statusFlash.undoArticleId}/status${readlistReturnQuery(input.filters, input.linkParams)}`,
		undoStatus: input.statusFlash.undoStatus,
	});
	return `<div id="status-toast" hx-swap-oob="outerHTML">${toast}</div>${counts}`;
}
