import { withInternalTracking } from "@packages/web-shell";

export interface DeleteConfirmViewModel {
	articleId: string;
	popoverId: string;
	url: string;
}

/**
 * The `queue-delete-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator.
 */
export function deleteConfirmPopoverId(articleId: string): string {
	return `queue-delete-confirm-${articleId}`;
}

export function toDeleteConfirmDisplayModel(
	confirm: DeleteConfirmViewModel,
): DeleteConfirmViewModel {
	return {
		...confirm,
		url: withInternalTracking(confirm.url, { source: "queue-card", content: "delete" }),
	};
}
