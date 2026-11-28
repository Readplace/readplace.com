import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

export interface DeleteConfirmViewModel {
	articleId: string;
	popoverId: string;
	fallbackId: string;
	url: string;
}

export interface ArticleDeletion {
	removePick?: true;
	articleId: string;
	url: string;
	confirm: DeleteConfirmViewModel | undefined;
}

type DeletionSurface = "queue-card" | "reader";

export const DELETE_ACK_NEVER = "never";

/** The reader's More options toggle: the return target of the reader's
 * in-page confirmation, whose Cancel is a fragment link. */
export const READER_MENU_TOGGLE_ID = "reader-article-menu";

/** The reader's title heading, whose text a poll settles in place. */
const READER_TITLE_ID = "reader-article-title";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

const DELETION_SWAP: Record<DeletionSurface, string> = {
	"queue-card": "outerHTML show:none",
	reader: "outerHTML show:window:top",
};

const DELETE_MENU_ITEMS_TEMPLATE = readFileSync(join(__dirname, "delete-menu-items.template.html"), "utf-8");
const DELETE_FALLBACK_TEMPLATE = readFileSync(join(__dirname, "delete-fallback.template.html"), "utf-8");

/**
 * The `readlist-delete-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator. The other ids below carry a prefix
 * for the same reason.
 */
export function deleteConfirmPopoverId(articleId: string): string {
	return `readlist-delete-confirm-${articleId}`;
}

export function deleteConfirmFallbackId(articleId: string): string {
	return `confirm-remove-${articleId}`;
}

export function articleMenuToggleId(articleId: string): string {
	return `article-menu-${articleId}`;
}

export function articleTitleId(articleId: string): string {
	return `readlist-title-${articleId}`;
}

function deletionDecisionsId(articleId: string): string {
	return `readlist-delete-decisions-${articleId}`;
}

export function buildArticleDeletion(input: {
	articleId: string;
	query: string;
	acknowledged: boolean | undefined;
	removePick?: boolean;
}): ArticleDeletion {
	const url = `/queue/${input.articleId}/delete${input.query}`;
	return {
		articleId: input.articleId,
		url,
		...(input.removePick ? { removePick: true as const } : {}),
		confirm: input.removePick || input.acknowledged
			? undefined
			: {
					articleId: input.articleId,
					popoverId: deleteConfirmPopoverId(input.articleId),
					fallbackId: deleteConfirmFallbackId(input.articleId),
					url,
				},
	};
}

function trackedDeletionUrl(input: { url: string; surface: DeletionSurface }): string {
	return withInternalTracking(input.url, { source: input.surface, content: "delete" });
}

export function renderDeleteMenuItems(input: { deletion: ArticleDeletion; surface: DeletionSurface }): string {
	if (input.surface === "queue-card" && input.deletion.removePick) return "";
	return render(DELETE_MENU_ITEMS_TEMPLATE, {
		label: input.deletion.removePick ? t("handPicked.remove") : t("readlistDelete.label"),
		url: trackedDeletionUrl({ url: input.deletion.url, surface: input.surface }),
		swap: DELETION_SWAP[input.surface],
		confirm: input.deletion.confirm,
	});
}

const DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="{{swap}}">
	<div class="confirm-popover__buttons">
		<button class="btn btn--neutral" type="submit" name="ack" value="{{ackNever}}" aria-describedby="{{neverHelpId}}" data-test-action="delete-confirm-never">{{t "readlistDelete.confirm.never"}}</button>
		<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="delete-cancel" autofocus>{{t "popover.cancel"}}</button>
		<button class="btn btn--primary" type="submit" data-test-action="delete-confirm">{{t "readlistDelete.label"}}</button>
	</div>
	<p class="article-delete__never-help" id="{{neverHelpId}}" data-test-delete-never-help>{{t "readlistDelete.confirm.neverHelp"}}</p>
</form>`;

function titleSourceId(input: { surface: DeletionSurface; articleId: string }): string {
	return input.surface === "reader" ? READER_TITLE_ID : articleTitleId(input.articleId);
}

function returnTargetId(input: { surface: DeletionSurface; articleId: string }): string {
	return input.surface === "reader" ? READER_MENU_TOGGLE_ID : articleMenuToggleId(input.articleId);
}

export function renderDeleteConfirm(input: {
	confirm: DeleteConfirmViewModel;
	surface: DeletionSurface;
	title: string;
	illustrationHtml?: string;
}): string {
	return renderConfirmPopover({
		id: input.confirm.popoverId,
		key: "delete",
		subject: input.confirm.articleId,
		title: t("readlistDelete.confirm.title"),
		subheading: input.title,
		subheadingFrom: titleSourceId({ surface: input.surface, articleId: input.confirm.articleId }),
		body: t("readlistDelete.confirm.body"),
		illustrationHtml: input.illustrationHtml,
		actionsHtml: render(DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: trackedDeletionUrl({ url: input.confirm.url, surface: input.surface }),
			swap: DELETION_SWAP[input.surface],
			ackNever: DELETE_ACK_NEVER,
			popoverId: input.confirm.popoverId,
			neverHelpId: `${input.confirm.popoverId}-never-help`,
		}),
	});
}

/** The same decision for a browser without native popovers: an in-page section
 * the menu reaches by fragment, shown only while it is the URL's `:target`. */
export function renderDeleteFallback(input: {
	confirm: DeleteConfirmViewModel;
	surface: DeletionSurface;
	title: string;
}): string {
	return render(DELETE_FALLBACK_TEMPLATE, {
		articleId: input.confirm.articleId,
		id: input.confirm.fallbackId,
		title: input.title,
		titleSourceId: titleSourceId({ surface: input.surface, articleId: input.confirm.articleId }),
		returnId: returnTargetId({ surface: input.surface, articleId: input.confirm.articleId }),
		url: trackedDeletionUrl({ url: input.confirm.url, surface: input.surface }),
		swap: DELETION_SWAP[input.surface],
		ackNever: DELETE_ACK_NEVER,
	});
}

const DELETION_DECISIONS_TEMPLATE = `<div class="article-delete__decisions" id="{{id}}"{{#if oob}} hx-swap-oob="innerHTML"{{/if}}>{{{html}}}</div>`;

/** Every page-level decision about deleting one article, in one container the
 * page always renders, so a response that removes or rewrites that article's
 * card can retire its decisions out of band without a missing target. */
export function renderDeletionDecisions(input: {
	deletion: ArticleDeletion;
	surface: DeletionSurface;
	title: string;
	illustrationHtml?: string;
}): string {
	const confirm = input.deletion.confirm;
	const html =
		confirm === undefined
			? ""
			: renderDeleteConfirm({ confirm, surface: input.surface, title: input.title, illustrationHtml: input.illustrationHtml }) +
				renderDeleteFallback({ confirm, surface: input.surface, title: input.title });
	return render(DELETION_DECISIONS_TEMPLATE, { id: deletionDecisionsId(input.deletion.articleId), html, oob: false });
}

/** Empties an article's decisions in place: for a response that removes its
 * card, or that answers with a card which deletes without asking. */
export function renderRetiredDeletionDecisionsOob(articleId: string): string {
	return render(DELETION_DECISIONS_TEMPLATE, { id: deletionDecisionsId(articleId), html: "", oob: true });
}
