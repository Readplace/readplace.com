import type { ArticleStatus } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, type ReadlistRef } from "@packages/domain/readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";
import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";

export interface MarkStatusConfirmViewModel {
	articleId: string;
	popoverId: string;
	url: string;
	status: ArticleStatus;
	readlists: readonly ReadlistRef[];
}

export const MARK_STATUS_ACK_NEVER = "never";

/**
 * The `readlist-mark-status-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator.
 */
export function markStatusConfirmPopoverId(articleId: string): string {
	return `readlist-mark-status-confirm-${articleId}`;
}

const STATUS_COPY = {
	read: {
		title: "Mark as read in all readlists?",
		bodyMultiple: "This article also appears in other readlists. Marking it as read will update it everywhere:",
		bodySingle: "This article will be marked as read in all readlists it belongs to:",
		confirm: "Mark as read everywhere",
		never: "Mark as read and don't ask again",
	},
	unread: {
		title: "Mark as unread in all readlists?",
		bodyMultiple: "This article also appears in other readlists. Marking it as unread will update it everywhere:",
		bodySingle: "This article will be marked as unread in all readlists it belongs to:",
		confirm: "Mark as unread everywhere",
		never: "Mark as unread and don't ask again",
	},
} as const satisfies Record<ArticleStatus, { title: string; bodyMultiple: string; bodySingle: string; confirm: string; never: string }>;

const MARK_STATUS_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<input type="hidden" name="status" value="{{status}}">
	<button class="btn btn--neutral" type="submit" name="ack" value="{{ackNever}}" data-test-action="mark-status-confirm-never">{{never}}</button>
	<button class="btn btn--primary" type="submit" data-test-action="mark-status-confirm">{{confirm}}</button>
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
		close: {},
		subject: input.confirm.articleId,
		title: copy.title,
		body: input.confirm.readlists.length > 1 ? copy.bodyMultiple : copy.bodySingle,
		bodyItems: input.confirm.readlists.map((readlist) => ({
			label: readlist.label,
			icon: READLIST_KIND_ICON[readlist.slug === DEFAULT_READLIST_SLUG ? "default" : "custom"],
		})),
		...(input.lead === undefined
			? {}
			: { lead: input.lead }),
		actionsHtml: render(MARK_STATUS_CONFIRM_ACTIONS_TEMPLATE, {
			url: withInternalTracking(input.confirm.url, {
				source: input.source,
				content: "mark-status",
			}),
			status: input.confirm.status,
			ackNever: MARK_STATUS_ACK_NEVER,
			confirm: copy.confirm,
			never: copy.never,
		}),
	});
}
