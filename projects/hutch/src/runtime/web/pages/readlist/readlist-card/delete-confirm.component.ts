import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

export interface DeleteConfirmViewModel {
	articleId: string;
	popoverId: string;
	url: string;
}

export const DELETE_ACK_NEVER = "never";

/**
 * The `readlist-delete-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator.
 */
export function deleteConfirmPopoverId(articleId: string): string {
	return `readlist-delete-confirm-${articleId}`;
}

const DELETE_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<button class="readlist-delete__cta" type="submit" data-test-action="delete-confirm">Yes, delete it</button>
	<button class="btn btn--secondary" type="submit" name="ack" value="{{ackNever}}" data-test-action="delete-confirm-never">Yes, delete it and don't ask again</button>
</form>`;

export function renderDeleteConfirm(input: {
	confirm: DeleteConfirmViewModel;
	title: string;
}): string {
	return renderConfirmPopover({
		id: input.confirm.popoverId,
		key: "delete",
		subject: input.confirm.articleId,
		title: "Delete this article?",
		body: "By deleting this you won't be able to find it anymore until you save it again.",
		lead: { text: `Article: ${input.title}`, screenReaderOnly: true },
		actionsHtml: render(DELETE_CONFIRM_ACTIONS_TEMPLATE, {
			url: withInternalTracking(input.confirm.url, {
				source: "queue-card",
				content: "delete",
			}),
			ackNever: DELETE_ACK_NEVER,
		}),
	});
}
