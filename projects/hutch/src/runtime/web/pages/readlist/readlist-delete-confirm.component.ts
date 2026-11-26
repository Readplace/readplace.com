import type { ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

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
	<button class="btn btn--primary" type="submit" data-test-action="readlist-delete-confirm" autofocus>Delete readlist</button>
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
		<button class="btn btn--primary" type="submit" data-test-action="readlist-delete-confirm" autofocus>Delete readlist</button>
	</div>
</form>`;

const PLAIN_QUESTION: ReadlistDeleteQuestion = {
	title: "Delete this readlist?",
	body: t("defaultReadlist.deleteBody"),
	actionsTemplate: PLAIN_ACTIONS_TEMPLATE,
};

const MOVE_OR_DELETE_QUESTION: ReadlistDeleteQuestion = {
	title: "Move or delete articles",
	body: "Articles that are also in the default readlist stay saved there. Before deleting this readlist, choose whether to move its articles to another readlist or delete them from this readlist.",
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
