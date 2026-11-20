import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	HAND_PICKED_MARKER_SINCE,
	type NewsletterLinkCount,
	REMOVAL_SKIP_REASONS,
} from "@packages/domain/article";
import { INBOX_PATH } from "@packages/domain/inbox";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import type { PageBody } from "@packages/web-shell";
import { render, withInternalTracking } from "@packages/web-shell";
import { NEWSLETTER_LINKS_STYLES } from "./newsletter-links.styles";
import {
	NEWSLETTER_LINKS_COUNT_PATH,
	NEWSLETTER_LINKS_REMOVE_PATH,
} from "./newsletter-links.url";

const { t, tPlural } = translator(inbox, DEFAULT_LOCALE);

const NEWSLETTER_LINKS_CONFIRM_TEMPLATE = readFileSync(
	join(__dirname, "newsletter-links-confirm.template.html"),
	"utf-8",
);

export type NewsletterLinksConfirmState = Exclude<
	NewsletterLinkCount,
	{ kind: "busy" }
>;

const COUNT_ACTION = withInternalTracking(NEWSLETTER_LINKS_COUNT_PATH, {
	source: "newsletter-links",
	content: "count",
});
const REMOVE_ACTION = withInternalTracking(NEWSLETTER_LINKS_REMOVE_PATH, {
	source: "newsletter-links",
	content: "remove",
});
const CHECK_AGAIN_HREF = withInternalTracking(NEWSLETTER_LINKS_REMOVE_PATH, {
	source: "newsletter-links",
	content: "check-again",
});

const MARKER_DATE = HAND_PICKED_MARKER_SINCE.toLocaleDateString(
	DEFAULT_LOCALE,
	{
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	},
);

function countedView(state: Extract<NewsletterLinkCount, { kind: "counted" }>) {
	const { summary, issues } = state.counted;
	const skippedTotal = REMOVAL_SKIP_REASONS.reduce(
		(total, reason) => total + summary.skipped[reason],
		0,
	);
	const skippedReasons = REMOVAL_SKIP_REASONS.filter(
		(reason) => summary.skipped[reason] > 0,
	).map((reason) =>
		t(`newsletterLinks.confirm.skippedReason.${reason}`, {
			count: summary.skipped[reason],
		}),
	);
	return {
		jobId: state.jobId,
		total: tPlural("newsletterLinks.confirm.total", {
			count: summary.selected,
		}),
		skipped:
			skippedTotal > 0
				? [
						tPlural("newsletterLinks.confirm.skipped", { count: skippedTotal }),
						...skippedReasons,
					]
				: [],
		issues: tPlural("newsletterLinks.confirm.issues", { count: issues }),
		beforeMarker:
			summary.savedBeforeMarker > 0
				? t("newsletterLinks.confirm.beforeMarker", { date: MARKER_DATE })
				: undefined,
		removeAction: summary.selected > 0 ? REMOVE_ACTION : undefined,
		senders: [...summary.bySender]
			.sort((a, b) => b.count - a.count)
			.map((sender) => ({
				senderEmail: sender.senderEmail,
				countLabel: tPlural("newsletterLinks.confirm.senderCount", {
					count: sender.count,
				}),
			})),
	};
}

function stateView(state: NewsletterLinksConfirmState) {
	switch (state.kind) {
		case "counting":
			return {
				counting: true,
				pollUrl: NEWSLETTER_LINKS_REMOVE_PATH,
				checkAgainHref: CHECK_AGAIN_HREF,
			};
		case "counted":
			return { counted: countedView(state) };
		case "none":
			return {
				countForm: COUNT_ACTION,
				countMessage: t("newsletterLinks.confirm.none"),
				countLabel: t("newsletterLinks.confirm.countButton"),
			};
		case "failed":
			return {
				countForm: COUNT_ACTION,
				countMessage: t("newsletterLinks.confirm.failed"),
				countLabel: t("newsletterLinks.confirm.tryAgain"),
			};
	}
}

export function NewsletterLinksConfirmPage(
	state: NewsletterLinksConfirmState,
): PageBody {
	return {
		seo: {
			title: `${t("newsletterLinks.confirm.title")} — Readplace`,
			description: t("newsletterLinks.confirm.title"),
			canonicalUrl: NEWSLETTER_LINKS_REMOVE_PATH,
			robots: "noindex, nofollow",
		},
		styles: NEWSLETTER_LINKS_STYLES,
		bodyClass: "page-newsletter-links",
		content: {
			html: render(NEWSLETTER_LINKS_CONFIRM_TEMPLATE, {
				state: state.kind,
				backHref: withInternalTracking(INBOX_PATH, {
					source: "newsletter-links",
					content: "back",
				}),
				...stateView(state),
			}),
		},
	};
}
