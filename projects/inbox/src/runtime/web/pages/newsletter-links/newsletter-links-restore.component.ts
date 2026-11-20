import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NewsletterLinkCount } from "@packages/domain/article";
import { INBOX_PATH } from "@packages/domain/inbox";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import type { PageBody } from "@packages/web-shell";
import { render, renderAlert, withInternalTracking } from "@packages/web-shell";
import type { NewsletterLinksConfirmState } from "./newsletter-links-confirm.component";
import { NEWSLETTER_LINKS_STYLES } from "./newsletter-links.styles";
import {
	NEWSLETTER_LINKS_COUNT_PATH,
	NEWSLETTER_LINKS_RESTORE_PATH,
} from "./newsletter-links.url";

const { t, tPlural } = translator(inbox, DEFAULT_LOCALE);

const NEWSLETTER_LINKS_RESTORE_TEMPLATE = readFileSync(
	join(__dirname, "newsletter-links-restore.template.html"),
	"utf-8",
);

const COUNT_ACTION = withInternalTracking(NEWSLETTER_LINKS_COUNT_PATH, {
	source: "newsletter-links-restore",
	content: "count",
});
const RESTORE_ACTION = withInternalTracking(NEWSLETTER_LINKS_RESTORE_PATH, {
	source: "newsletter-links-restore",
	content: "restore",
});
const CHECK_AGAIN_HREF = withInternalTracking(NEWSLETTER_LINKS_RESTORE_PATH, {
	source: "newsletter-links-restore",
	content: "check-again",
});

function countedView(state: Extract<NewsletterLinkCount, { kind: "counted" }>) {
	const { bySender, unrestorable } = state.counted.held;
	const total = bySender.reduce((sum, sender) => sum + sender.count, 0);
	return {
		jobId: state.jobId,
		total: tPlural("newsletterLinks.restore.total", { count: total }),
		restoreAction: total > 0 ? RESTORE_ACTION : undefined,
		senders: bySender.map((sender) => ({
			senderEmail: sender.senderEmail,
			countLabel: tPlural("newsletterLinks.confirm.senderCount", {
				count: sender.count,
			}),
		})),
		unrestorable:
			unrestorable.length > 0
				? {
						sentence: tPlural("newsletterLinks.restore.unrestorable", {
							count: unrestorable.length,
						}),
						links: unrestorable,
					}
				: undefined,
	};
}

function stateView(state: NewsletterLinksConfirmState) {
	switch (state.kind) {
		case "counting":
			return {
				counting: true,
				pollUrl: NEWSLETTER_LINKS_RESTORE_PATH,
				checkAgainHref: CHECK_AGAIN_HREF,
			};
		case "counted":
			return { counted: countedView(state) };
		case "none":
			return {
				countForm: COUNT_ACTION,
				countMessage: t("newsletterLinks.restore.none"),
				countLabel: t("newsletterLinks.restore.countButton"),
			};
		case "failed":
			return {
				countForm: COUNT_ACTION,
				countAlertHtml: renderAlert({
					key: "newsletter-links-count-failed",
					content: {
						variant: "error",
						message: { text: t("newsletterLinks.restore.failed") },
					},
				}),
				countLabel: t("newsletterLinks.confirm.tryAgain"),
			};
	}
}

export function NewsletterLinksRestorePage(
	state: NewsletterLinksConfirmState,
): PageBody {
	return {
		seo: {
			title: `${t("newsletterLinks.restore.title")} — Readplace`,
			description: t("newsletterLinks.restore.title"),
			canonicalUrl: NEWSLETTER_LINKS_RESTORE_PATH,
			robots: "noindex, nofollow",
		},
		styles: NEWSLETTER_LINKS_STYLES,
		bodyClass: "page-newsletter-links",
		content: {
			html: render(NEWSLETTER_LINKS_RESTORE_TEMPLATE, {
				state: state.kind,
				backHref: withInternalTracking(INBOX_PATH, {
					source: "newsletter-links-restore",
					content: "back",
				}),
				...stateView(state),
			}),
		},
	};
}
