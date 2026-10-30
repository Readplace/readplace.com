import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

export interface DeleteConfirmViewModel {
	articleId: string;
	popoverId: string;
	url: string;
}

export interface ArticleDeletion {
	articleId: string;
	url: string;
	confirm: DeleteConfirmViewModel | undefined;
}

type DeletionSurface = "queue-card" | "reader";

export const DELETE_ACK_NEVER = "never";

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
}): ArticleDeletion {
	const url = `/queue/${input.articleId}/delete${input.query}`;
	return {
		articleId: input.articleId,
		url,
		confirm: input.acknowledged
			? undefined
			: { articleId: input.articleId, popoverId: deleteConfirmPopoverId(input.articleId), url },
	};
}

function trackedDeletionUrl(input: { url: string; surface: DeletionSurface }): string {
	return withInternalTracking(input.url, { source: input.surface, content: "delete" });
}

export function renderDeleteMenuItems(input: { deletion: ArticleDeletion; surface: DeletionSurface }): string {
	return render(DELETE_MENU_ITEMS_TEMPLATE, {
		url: trackedDeletionUrl({ url: input.deletion.url, surface: input.surface }),
		swap: DELETION_SWAP[input.surface],
		confirm: input.deletion.confirm,
	});
}

const DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="{{swap}}">
	<button class="btn btn--neutral" type="submit" name="ack" value="{{ackNever}}" data-test-action="delete-confirm-never">Delete and don't ask again</button>
	<button class="btn btn--primary" type="submit" data-test-action="delete-confirm" autofocus>Delete article</button>
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
		title: "Delete this article?",
		body: "This article will be removed from your readlist. You can save it again later.",
		lead: `Article: ${input.title}`,
		illustrationHtml: input.illustrationHtml,
		actionsHtml: render(DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: trackedDeletionUrl({ url: input.confirm.url, surface: input.surface }),
			swap: DELETION_SWAP[input.surface],
			ackNever: DELETE_ACK_NEVER,
		}),
	});
}
