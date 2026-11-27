import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ISSUE_SKIP_REASONS,
	type NewsletterLinkCount,
	REMOVAL_SKIP_REASONS,
} from "@packages/domain/article";
import { INBOX_PATH } from "@packages/domain/inbox";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import type { PageBody } from "@packages/web-shell";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderConfirmPopover,
	withInternalTracking,
} from "@packages/web-shell";
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

const CONFIRM_POPOVER_ID = "newsletter-links-confirm";

const CONFIRM_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions confirm-popover__buttons">
	<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="newsletter-links-confirm-cancel">{{t "newsletterLinks.confirm.popover.cancel"}}</button>
	<button class="btn btn--destructive" type="submit" autofocus data-test-newsletter-links-submit>{{t "newsletterLinks.confirm.submit"}}</button>
</div>`;

const CONFIRM_POPOVER_HTML = renderConfirmPopover({
	id: CONFIRM_POPOVER_ID,
	key: "newsletter-links-confirm",
	title: t("newsletterLinks.confirm.popover.title"),
	body: t("newsletterLinks.confirm.popover.body"),
	actionsHtml: render(CONFIRM_ACTIONS_TEMPLATE, { popoverId: CONFIRM_POPOVER_ID }),
});

export function senderCountLabel(params: { links: number; issues: number }): string {
	const links = tPlural("newsletterLinks.confirm.senderCount", { count: params.links });
	const issues = tPlural("newsletterLinks.confirm.senderIssueCount", { count: params.issues });
	if (params.issues === 0) return links;
	if (params.links === 0) return issues;
	return t("newsletterLinks.confirm.senderLinksAndIssues", { links, issues });
}

export function senderEmailParts(senderEmail: string): { senderMailbox: string; senderDomain: string } {
	const domainStart = senderEmail.lastIndexOf("@") + 1;
	return { senderMailbox: senderEmail.slice(0, domainStart), senderDomain: senderEmail.slice(domainStart) };
}

function mergedSenders(params: {
	links: readonly { senderEmail: string; count: number }[];
	issues: readonly { senderEmail: string; count: number }[];
}) {
	const senders = new Map<string, { links: number; issues: number }>();
	for (const sender of params.links) senders.set(sender.senderEmail, { links: sender.count, issues: 0 });
	for (const sender of params.issues) {
		const known = senders.get(sender.senderEmail) ?? { links: 0, issues: 0 };
		senders.set(sender.senderEmail, { ...known, issues: sender.count });
	}
	return [...senders]
		.map(([senderEmail, counts]) => ({ senderEmail, ...counts }))
		.sort((a, b) => b.links + b.issues - (a.links + a.issues) || a.senderEmail.localeCompare(b.senderEmail))
		.map((sender) => ({
			senderEmail: sender.senderEmail,
			...senderEmailParts(sender.senderEmail),
			countLabel: senderCountLabel(sender),
		}));
}

function countedView(state: Extract<NewsletterLinkCount, { kind: "counted" }>) {
	const { summary, issues } = state.counted;
	const linkReasons = REMOVAL_SKIP_REASONS.filter((reason) => summary.skipped[reason] > 0).map((reason) =>
		tPlural(`newsletterLinks.confirm.skippedReason.${reason}`, { count: summary.skipped[reason] }),
	);
	const issueReasons = ISSUE_SKIP_REASONS.filter((reason) => issues.skipped[reason] > 0).map((reason) =>
		tPlural(`newsletterLinks.confirm.skippedIssueReason.${reason}`, { count: issues.skipped[reason] }),
	);
	const skippedTotal =
		REMOVAL_SKIP_REASONS.reduce((total, reason) => total + summary.skipped[reason], 0) +
		ISSUE_SKIP_REASONS.reduce((total, reason) => total + issues.skipped[reason], 0);
	const removes = summary.selected + issues.selected > 0;
	return {
		jobId: state.jobId,
		total: tPlural("newsletterLinks.confirm.total", {
			count: summary.selected,
		}),
		skipped:
			skippedTotal > 0
				? {
						heading: t("newsletterLinks.confirm.skipped"),
						reasons: [...linkReasons, ...issueReasons],
					}
				: undefined,
		issues: tPlural("newsletterLinks.confirm.issues", { count: issues.selected }),
		removeAction: removes ? REMOVE_ACTION : undefined,
		popoverId: CONFIRM_POPOVER_ID,
		popoverHtml: CONFIRM_POPOVER_HTML,
		senders: mergedSenders({ links: summary.bySender, issues: issues.bySender }),
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
				countAlertHtml: renderAlert({
					key: "newsletter-links-count-failed",
					content: {
						variant: "error",
						message: { text: t("newsletterLinks.confirm.failed") },
					},
				}),
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
		styles: `${NEWSLETTER_LINKS_STYLES}\n${CONFIRM_POPOVER_STYLES}`,
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
