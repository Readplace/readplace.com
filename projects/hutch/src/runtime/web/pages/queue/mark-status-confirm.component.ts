import type { ArticleStatus } from "@packages/domain/article";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

export interface MarkStatusConfirmViewModel {
	articleId: string;
	popoverId: string;
	url: string;
	status: ArticleStatus;
	queueLabels: readonly string[];
}

export const MARK_STATUS_ACK_NEVER = "never";

/**
 * The `queue-mark-status-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator.
 */
export function markStatusConfirmPopoverId(articleId: string): string {
	return `queue-mark-status-confirm-${articleId}`;
}

const STATUS_COPY = {
	read: { title: "Mark as read everywhere?", outcome: "marked as read" },
	unread: { title: "Mark as unread everywhere?", outcome: "marked as unread" },
} as const satisfies Record<ArticleStatus, { title: string; outcome: string }>;

const MARK_STATUS_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<input type="hidden" name="status" value="{{status}}">
	<button class="btn btn--primary" type="submit" data-test-action="mark-status-confirm">Ok, I understand</button>
	<button class="btn btn--secondary" type="submit" name="ack" value="{{ackNever}}" data-test-action="mark-status-confirm-never">Ok, don't show this again</button>
</form>`;

export function renderMarkStatusConfirm(input: {
	confirm: MarkStatusConfirmViewModel;
	source: "queue-card" | "reader";
	lead?: string;
}): string {
	const copy = STATUS_COPY[input.confirm.status];
	return renderConfirmPopover({
		id: input.confirm.popoverId,
		key: "mark-status",
		subject: input.confirm.articleId,
		title: copy.title,
		body: `This article will be ${copy.outcome} in all queues it belongs to:`,
		bodyItems: input.confirm.queueLabels,
		...(input.lead === undefined
			? {}
			: { lead: { text: input.lead, screenReaderOnly: true } }),
		actionsHtml: render(MARK_STATUS_CONFIRM_ACTIONS_TEMPLATE, {
			url: withInternalTracking(input.confirm.url, {
				source: input.source,
				content: "mark-status",
			}),
			status: input.confirm.status,
			ackNever: MARK_STATUS_ACK_NEVER,
		}),
	});
}
