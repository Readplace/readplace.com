import type { ArticleStatus } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, type ReadlistRef } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
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

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

/**
 * The `readlist-mark-status-confirm-` prefix is load-bearing, not cosmetic: a
 * ReaderArticleHashId is /^[0-9a-f]{32}$/ and may start with a digit, which is a
 * legal HTML id but an illegal CSS ident — `#1a2b…` silently never matches in
 * CSS and throws in a Playwright locator.
 */
export function markStatusConfirmPopoverId(articleId: string): string {
	return `readlist-mark-status-confirm-${articleId}`;
}

const MARK_STATUS_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons confirm-popover__buttons--full-width" method="POST" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<input type="hidden" name="status" value="{{status}}">
	<button class="btn btn--primary" type="submit" name="ack" value="{{ackNever}}" data-test-action="mark-status-confirm" autofocus>{{t "readlistMarkStatus.acknowledge"}}</button>
</form>`;

export function renderMarkStatusConfirm(input: {
	confirm: MarkStatusConfirmViewModel;
	source: "queue-card" | "reader";
	lead?: string;
	oob?: boolean;
}): string {
	return renderConfirmPopover({
		id: input.confirm.popoverId,
		key: "mark-status",
		close: {},
		oob: input.oob,
		subject: input.confirm.articleId,
		title: t("readlistMarkStatus.title"),
		body: t(`readlistMarkStatus.body.${input.confirm.status}`),
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
		}),
	});
}
