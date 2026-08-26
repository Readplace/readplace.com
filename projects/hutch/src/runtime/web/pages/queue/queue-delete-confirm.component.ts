import type { QueueSlug } from "@packages/domain/queue";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { DEFAULT_QUEUE } from "./queue.nav";

export function queueDeleteConfirmPopoverId(queue: QueueSlug): string {
	return `queue-remove-confirm-${queue}`;
}

export interface QueueDeleteDestination {
	slug: QueueSlug;
	label: string;
}

const QUEUE_DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<div class="queue-migrate {{visibilityClass}}" data-test-queue-migrate>
		<label class="queue-migrate__label" for="{{selectId}}">Move its articles to</label>
		<select class="queue-migrate__select" id="{{selectId}}" name="migrate_to" data-test-migrate-select>
			<option value="">Nowhere, delete them too</option>
			{{#each destinations}}
			<option value="{{slug}}" data-test-migrate-target="{{slug}}">{{label}}</option>
			{{/each}}
		</select>
	</div>
	<button class="queue-delete__cta" type="submit" data-test-action="queue-delete-confirm">
		<span class="queue-delete__cta-label queue-delete__cta-label--delete">Confirm Deletion</span>
		<span class="queue-delete__cta-label queue-delete__cta-label--migrate">Move and Delete</span>
	</button>
</form>`;

export function renderQueueDeleteConfirm(input: {
	popoverId: string;
	url: string;
	label: string;
	destinations: readonly QueueDeleteDestination[];
}): string {
	const offersMigration = input.destinations.length > 0;
	return renderConfirmPopover({
		id: input.popoverId,
		key: "queue-delete",
		title: "Delete this queue?",
		body: offersMigration
			? `Deleting takes this queue's copies with it. Move them to another queue to keep them together, or leave them behind and keep only what ${DEFAULT_QUEUE.label} already holds.`
			: `Deleting takes this queue's copies with it. Anything you also saved in ${DEFAULT_QUEUE.label} stays there.`,
		lead: { text: `Queue: ${input.label}`, screenReaderOnly: true },
		actionsHtml: render(QUEUE_DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: withInternalTracking(input.url, {
				source: "queue-nav",
				content: "queue-delete",
			}),
			visibilityClass: offersMigration ? "queue-migrate--visible" : "queue-migrate--hidden",
			selectId: `${input.popoverId}-destination`,
			destinations: input.destinations,
		}),
	});
}
