import type { ReadlistSlug } from "@packages/domain/readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { DEFAULT_READLIST } from "./readlist.nav";

export function readlistDeleteConfirmPopoverId(readlist: ReadlistSlug): string {
	return `readlist-remove-confirm-${readlist}`;
}

export interface ReadlistDeleteDestination {
	slug: ReadlistSlug;
	label: string;
}

const READLIST_DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<div class="readlist-migrate {{visibilityClass}}" data-test-readlist-migrate>
		<label class="readlist-migrate__label" for="{{selectId}}">Move its articles to</label>
		<select class="readlist-migrate__select" id="{{selectId}}" name="migrate_to" data-test-migrate-select>
			<option value="">Nowhere, delete them too</option>
			{{#each destinations}}
			<option value="{{slug}}" data-test-migrate-target="{{slug}}">{{label}}</option>
			{{/each}}
		</select>
	</div>
	<button class="readlist-delete__cta" type="submit" data-test-action="readlist-delete-confirm">
		<span class="readlist-delete__cta-label readlist-delete__cta-label--delete">Confirm Deletion</span>
		<span class="readlist-delete__cta-label readlist-delete__cta-label--migrate">Move and Delete</span>
	</button>
</form>`;

export function renderReadlistDeleteConfirm(input: {
	popoverId: string;
	url: string;
	label: string;
	destinations: readonly ReadlistDeleteDestination[];
}): string {
	const offersMigration = input.destinations.length > 0;
	return renderConfirmPopover({
		id: input.popoverId,
		key: "readlist-delete",
		title: "Delete this readlist?",
		body: offersMigration
			? `Deleting takes this readlist's copies with it. Move them to another readlist to keep them together, or leave them behind and keep only what ${DEFAULT_READLIST.label} already holds.`
			: `Deleting takes this readlist's copies with it. Anything you also saved in ${DEFAULT_READLIST.label} stays there.`,
		lead: { text: `Readlist: ${input.label}`, screenReaderOnly: true },
		actionsHtml: render(READLIST_DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: withInternalTracking(input.url, {
				source: "queue-nav",
				content: "queue-delete",
			}),
			visibilityClass: offersMigration ? "readlist-migrate--visible" : "readlist-migrate--hidden",
			selectId: `${input.popoverId}-destination`,
			destinations: input.destinations,
		}),
	});
}
