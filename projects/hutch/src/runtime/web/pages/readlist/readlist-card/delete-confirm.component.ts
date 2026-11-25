import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

export interface DeleteConfirmViewModel {
	articleId: string;
	popoverId: string;
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

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

const DELETION_SWAP: Record<DeletionSurface, string> = {
	"queue-card": "outerHTML show:none",
	reader: "outerHTML show:window:top",
};

const DELETE_MENU_ITEMS_TEMPLATE = readFileSync(join(__dirname, "delete-menu-items.template.html"), "utf-8");

/**
 * The `readlist-delete-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator.
 */
export function deleteConfirmPopoverId(articleId: string): string {
	return `readlist-delete-confirm-${articleId}`;
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
			: { articleId: input.articleId, popoverId: deleteConfirmPopoverId(input.articleId), url },
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

const DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="{{swap}}">
	<button class="btn btn--neutral" type="submit" name="ack" value="{{ackNever}}" data-test-action="delete-confirm-never">{{t "readlistDelete.confirm.never"}}</button>
	<button class="btn btn--primary" type="submit" data-test-action="delete-confirm" autofocus>{{t "readlistDelete.label"}}</button>
</form>`;

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
		body: t("readlistDelete.confirm.body"),
		lead: t("readlistDelete.confirm.lead", { title: input.title }),
		illustrationHtml: input.illustrationHtml,
		actionsHtml: render(DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: trackedDeletionUrl({ url: input.confirm.url, surface: input.surface }),
			swap: DELETION_SWAP[input.surface],
			ackNever: DELETE_ACK_NEVER,
		}),
	});
}
