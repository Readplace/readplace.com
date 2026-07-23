import { render, renderToast, withInternalTracking } from "@packages/web-shell";

/** Long enough to read the message and reach for Undo, short enough not to
 * linger; the global toast.client script removes it after this delay. */
export const STATUS_TOAST_DISMISS_MS = 6000;

/** Stable-id mount the queue template wraps around the toast and the mutation
 * response replaces out-of-band, so a card-scoped status POST can deliver its
 * confirmation toast without re-rendering the listing. */
export const STATUS_TOAST_MOUNT_ID = "status-toast";

/** Stable id of the counts loader span. The template renders it inert; a card
 * mutation OOB-replaces it with an identical span so its `hx-trigger="load"`
 * re-fires and the badge/page-count refresh off the mutation's critical path. */
export const QUEUE_COUNTS_ID = "queue-counts";

export interface QueueStatusFlashView {
	message: string;
	undoUrl: string;
	undoStatus: "read" | "unread";
}

/** The confirmation toast for a status change, with a working Undo that posts
 * the opposite status back. Shared by the full listing render (queue.component)
 * and the card-scoped mutation response so the two can't drift. */
export function renderQueueStatusToast(flash: QueueStatusFlashView): string {
	return renderToast({
		message: flash.message,
		dismissMs: STATUS_TOAST_DISMISS_MS,
		actions: [
			{
				method: "POST",
				url: withInternalTracking(flash.undoUrl, { source: "queue-toast", content: "undo" }),
				label: "Undo",
				fields: [{ name: "status", value: flash.undoStatus }],
			},
		],
	});
}

const COUNTS_TRIGGER_TEMPLATE = `<span id="${QUEUE_COUNTS_ID}" hx-get="{{countsUrl}}" hx-trigger="load" hx-swap="none" data-test-queue-counts{{#if oob}} hx-swap-oob="outerHTML"{{/if}}></span>`;

/** The counts loader span. `oob:false` renders the inert span the template
 * mounts; `oob:true` renders the identical span the mutation response swaps
 * over it, re-arming the `hx-trigger="load"` so GET /queue/counts re-runs. */
export function renderQueueCountsTrigger(input: { countsUrl: string; oob: boolean }): string {
	return render(COUNTS_TRIGGER_TEMPLATE, input);
}

/** OOB toast wrapped in its stable mount, for the card-scoped status response. */
export function renderStatusToastOob(flash: QueueStatusFlashView): string {
	return `<div id="${STATUS_TOAST_MOUNT_ID}" hx-swap-oob="outerHTML">${renderQueueStatusToast(flash)}</div>`;
}

/** Body of a card-scoped status mutation response: the primary content is empty
 * (an outerHTML swap of empty content removes the card htmx targeted), and the
 * out-of-band toast + counts re-arm ride alongside it. */
export function renderStatusMutationFragment(input: {
	flash: QueueStatusFlashView;
	countsUrl: string;
}): string {
	return (
		renderStatusToastOob(input.flash) +
		renderQueueCountsTrigger({ countsUrl: input.countsUrl, oob: true })
	);
}

/** Body of a card-scoped delete mutation response: empty primary content (card
 * removed) plus the counts re-arm. Delete carries no toast, matching today. */
export function renderDeleteMutationFragment(input: { countsUrl: string }): string {
	return renderQueueCountsTrigger({ countsUrl: input.countsUrl, oob: true });
}
