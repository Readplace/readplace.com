import type { ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { READLIST_KIND_ICON } from "../../../shared/readlist-kind-icon";
import { renderReadlistFilter } from "../../../shared/readlist-filter/readlist-filter.component";
import { isBuiltInReadlist } from "../built-in-readlists";
import { renderReadlistCreate, renderReadlistCreateForm } from "../readlist-create.component";
import { DEFAULT_READLIST } from "../readlist.nav";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

export interface ArticleMoveDestination {
	slug: ReadlistSlug;
	label: string;
	smart?: true;
}

export interface ArticleMoveViewModel {
	articleId: string;
	popoverId: string;
	mode: "move" | "add";
	from: ReadlistSlug;
	url: string;
	destinations: readonly ArticleMoveDestination[];
	create?: { popoverId: string };
	opens: string;
}

export function moveDialogPopoverId(articleId: string): string {
	return `readlist-move-${articleId}`;
}

export function moveCreatePopoverId(articleId: string): string {
	return `readlist-create-move-${articleId}`;
}

const MOVE_CREATE_KEY = "readlist-create-move";

interface MoveCopy {
	itemLabel: string;
	title: string;
	body: string;
	commitLabel: string;
	fallbackLabel: string;
}

const MOVE_COPY: Record<ArticleMoveViewModel["mode"], MoveCopy> = {
	move: {
		itemLabel: "Move to readlist",
		title: "Move to another readlist",
		body: "Choose where you'd like to move this article. It will be removed from its current readlist and added to the selected one.",
		commitLabel: "Move",
		fallbackLabel: "Move to",
	},
	add: {
		itemLabel: "Add to readlist",
		title: "Add to a readlist",
		body: `Choose a readlist for this article. It also stays in ${DEFAULT_READLIST.label}, which keeps everything you save.`,
		commitLabel: "Add",
		fallbackLabel: "Add to",
	},
};

interface MoveChoice {
	inputType: "radio" | "checkbox";
	required: boolean;
}

const MOVE_CHOICE: Record<ArticleMoveViewModel["mode"], MoveChoice> = {
	move: { inputType: "radio", required: true },
	add: { inputType: "checkbox", required: false },
};

function picksInOneClick(move: ArticleMoveViewModel): boolean {
	return move.mode === "add" && move.destinations.length === 1;
}

const MOVE_DIALOG_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions readlist-move" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none" data-readlist-filter-scope data-test-form="readlist-move">
	<input type="hidden" name="from" value="{{from}}">
	{{{filterHtml}}}
	<div class="readlist-move__list">
		<fieldset class="readlist-move__options">
			<legend class="sr-only">Readlists</legend>
			{{#each destinations}}
			{{#if ../oneClick}}
			<button class="readlist-row readlist-move__option readlist-move__pick readlist-filter__option" type="submit" name="to" value="{{slug}}" data-test-move-destination="{{slug}}"{{#if smart}} aria-label="{{accessibleName}}" data-test-readlist-smart{{/if}}{{#if autofocus}} autofocus{{/if}}><span class="readlist-row__main">{{icon iconName}}<span class="readlist-row__label">{{label}}</span>{{#if smart}}<span class="readlist-row__smart">{{icon "sparkles"}}</span>{{/if}}</span></button>
			{{else}}
			<label class="readlist-row readlist-move__option readlist-filter__option" data-test-move-destination="{{slug}}"><span class="readlist-row__main">{{icon iconName}}<span class="readlist-row__label">{{label}}</span>{{#if smart}}<span class="readlist-row__smart">{{icon "sparkles"}}</span>{{/if}}</span><span class="readlist-row__trailing readlist-move__choice-slot"><input class="form-choice readlist-move__choice" type="{{../choice.inputType}}" name="to" value="{{slug}}"{{#if smart}} aria-label="{{accessibleName}}" data-test-readlist-smart{{/if}}{{#if ../choice.required}} required{{/if}}{{#if autofocus}} autofocus{{/if}}></span></label>
			{{/if}}
			{{/each}}
		</fieldset>
		{{#each createRows}}
		<div class="readlist-row readlist-move__create-row"><button class="readlist-row__main readlist-move__create" type="button" popovertarget="{{popoverId}}" aria-haspopup="dialog" data-test-action="move-create">{{icon "plus"}}<span class="readlist-row__label">Create a readlist</span></button></div>
		{{/each}}
	</div>
	<div class="confirm-popover__buttons">
		<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="move-cancel">Cancel</button>
		{{#unless oneClick}}
		<button class="btn btn--primary" type="submit" data-test-action="move-confirm">{{commitLabel}}</button>
		{{/unless}}
	</div>
</form>`;

const MOVE_FALLBACK_TEMPLATE = `<form class="readlist-article__menu-form readlist-article__fallback readlist-article__move-fallback" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<input type="hidden" name="from" value="{{from}}">
	<div class="form-field">
		<label class="form-field__label" for="{{selectId}}">{{fallbackLabel}}</label>
		<div class="form-input form-input--within form-input--select">
			<select class="form-input__control" id="{{selectId}}" name="to"{{#if multiple}} multiple{{/if}} data-test-move-select>
				{{#each destinations}}
				<option value="{{slug}}">{{label}}</option>
				{{/each}}
			</select>
			{{#unless multiple}}
			<span class="form-input__chevron">{{icon "chevron-down"}}</span>
			{{/unless}}
		</div>
	</div>
	<button class="btn btn--primary" type="submit" data-test-action="move-fallback">{{commitLabel}}</button>
</form>`;

const MOVE_TRIGGER_TEMPLATE = `<button class="menu__item readlist-article__confirm-trigger" type="button" popovertarget="{{opens}}" aria-haspopup="dialog" title="{{itemLabel}}" data-test-action="move">{{icon "folder-input"}}<span>{{itemLabel}}</span></button>`;

function moveAction(move: ArticleMoveViewModel): string {
	return withInternalTracking(move.url, { source: "queue-card", content: "move" });
}

function renderMoveDialog(move: ArticleMoveViewModel, title: string): string {
	const copy = MOVE_COPY[move.mode];
	return renderConfirmPopover({
		id: move.popoverId,
		key: "move",
		subject: move.articleId,
		title: copy.title,
		body: copy.body,
		lead: `Article: ${title}`,
		actionsHtml: render(MOVE_DIALOG_ACTIONS_TEMPLATE, {
			action: moveAction(move),
			from: move.from,
			popoverId: move.popoverId,
			commitLabel: copy.commitLabel,
			choice: MOVE_CHOICE[move.mode],
			oneClick: picksInOneClick(move),
			filterHtml: renderReadlistFilter({ readlistCount: move.destinations.length, tag: "div" }),
			destinations: move.destinations.map((destination, index) => ({
				slug: destination.slug,
				label: destination.label,
				iconName: READLIST_KIND_ICON[isBuiltInReadlist(destination.slug) ? "default" : "custom"],
				smart: destination.smart === true,
				accessibleName: t("readlistSmart.accessibleName", { name: destination.label }),
				autofocus: index === 0,
			})),
			createRows: move.create === undefined ? [] : [move.create],
		}),
	});
}

function renderMoveCreateDialog(move: ArticleMoveViewModel): string {
	return renderReadlistCreate({
		popoverId: moveCreatePopoverId(move.articleId),
		key: MOVE_CREATE_KEY,
		action: withInternalTracking(move.url, { source: "queue-card", content: "create-and-move" }),
		hiddenFields: [{ name: "from", value: move.from }],
	});
}

export function renderMoveDialogs(input: { move: ArticleMoveViewModel; title: string }): string[] {
	const { move } = input;
	return [
		...(move.destinations.length === 0 ? [] : [renderMoveDialog(move, input.title)]),
		...(move.create === undefined ? [] : [renderMoveCreateDialog(move)]),
	];
}

export function renderMoveCreateForm(input: {
	articleId: string;
	action: string;
	from: ReadlistSlug;
	value: string;
	error: string;
}): string {
	return renderReadlistCreateForm({
		popoverId: moveCreatePopoverId(input.articleId),
		key: MOVE_CREATE_KEY,
		action: input.action,
		value: input.value,
		error: input.error,
		hiddenFields: [{ name: "from", value: input.from }],
	});
}

export function renderMoveMenuItems(input: { move: ArticleMoveViewModel }): string {
	const { move } = input;
	const copy = MOVE_COPY[move.mode];
	const fallbackHtml =
		move.destinations.length === 0
			? ""
			: render(MOVE_FALLBACK_TEMPLATE, {
					action: moveAction(move),
					from: move.from,
					selectId: `readlist-move-select-${move.articleId}`,
					fallbackLabel: copy.fallbackLabel,
					commitLabel: copy.commitLabel,
					multiple: MOVE_CHOICE[move.mode].inputType === "checkbox" && move.destinations.length >= 2,
					destinations: move.destinations,
				});
	return `${fallbackHtml}${render(MOVE_TRIGGER_TEMPLATE, { opens: move.opens, itemLabel: copy.itemLabel })}`;
}
