import type { QueueSlug } from "@packages/domain/queue";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { DEFAULT_QUEUE } from "./queue.nav";

export function queueDeleteConfirmPopoverId(queue: QueueSlug): string {
	return `queue-remove-confirm-${queue}`;
}

const QUEUE_DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<button class="queue-delete__cta" type="submit" data-test-action="queue-delete-confirm">Confirm Deletion</button>
</form>`;

export function renderQueueDeleteConfirm(input: {
	popoverId: string;
	url: string;
	label: string;
}): string {
	return renderConfirmPopover({
		id: input.popoverId,
		key: "queue-delete",
		title: "Delete this queue?",
		body: `Removing this will not delete the articles, they still exist in ${DEFAULT_QUEUE.label}.`,
		lead: { text: `Queue: ${input.label}`, screenReaderOnly: true },
		actionsHtml: render(QUEUE_DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: withInternalTracking(input.url, {
				source: "queue-nav",
				content: "queue-delete",
			}),
		}),
	});
}
