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

interface ReadlistDeleteQuestion {
	title: string;
	body: string;
	actionsTemplate: string;
}

const PLAIN_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="readlist-delete-cancel">Cancel</button>
	<button class="btn btn--primary" type="submit" data-test-action="readlist-delete-confirm">Delete readlist</button>
</form>`;

const MOVE_OR_DELETE_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions readlist-migrate" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<div class="form-field">
		<label class="form-field__label" for="{{selectId}}">Move articles to</label>
		<div class="form-input form-input--within form-input--select">
			<select class="form-input__control" id="{{selectId}}" name="migrate_to" data-test-migrate-select>
				{{#each destinations}}
				<option value="{{slug}}" data-test-migrate-target="{{slug}}">{{label}}</option>
				{{/each}}
				<option value="">Nowhere, delete them too</option>
			</select>
			<span class="form-input__chevron">{{icon "chevron-down"}}</span>
		</div>
	</div>
	<div class="confirm-popover__buttons">
		<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="readlist-delete-cancel">Cancel</button>
		<button class="btn btn--primary" type="submit" data-test-action="readlist-delete-confirm">Delete readlist</button>
	</div>
</form>`;

const PLAIN_QUESTION: ReadlistDeleteQuestion = {
	title: "Delete this readlist?",
	body: `This readlist will be permanently deleted. Articles saved in ${DEFAULT_READLIST.label} will remain in your library.`,
	actionsTemplate: PLAIN_ACTIONS_TEMPLATE,
};

const MOVE_OR_DELETE_QUESTION: ReadlistDeleteQuestion = {
	title: "Move or delete articles",
	body: "Before deleting this readlist, choose whether to move its articles to another readlist or delete them.",
	actionsTemplate: MOVE_OR_DELETE_ACTIONS_TEMPLATE,
};

export function renderReadlistDeleteConfirm(input: {
	slug: ReadlistSlug;
	url: string;
	label: string;
	destinations: readonly ReadlistDeleteDestination[];
	holdsArticles: boolean;
	illustrationHtml: string;
}): string {
	const popoverId = readlistDeleteConfirmPopoverId(input.slug);
	const question =
		input.holdsArticles && input.destinations.length > 0 ? MOVE_OR_DELETE_QUESTION : PLAIN_QUESTION;
	return renderConfirmPopover({
		id: popoverId,
		key: "readlist-delete",
		subject: input.slug,
		title: question.title,
		body: question.body,
		lead: `Readlist: ${input.label}`,
		illustrationHtml: input.illustrationHtml,
		actionsHtml: render(question.actionsTemplate, {
			url: withInternalTracking(input.url, {
				source: "queue-nav",
				content: "queue-delete",
			}),
			popoverId,
			selectId: `${popoverId}-destination`,
			destinations: input.destinations,
		}),
	});
}
