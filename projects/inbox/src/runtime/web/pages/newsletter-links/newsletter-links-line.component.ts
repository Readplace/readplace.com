import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type NewsletterLinksLine,
	REMOVAL_SKIP_REASONS,
	type SavedLinksJobBulkAction,
	type SavedLinksJobCounts,
} from "@packages/domain/article";
import { INBOX_PATH } from "@packages/domain/inbox";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import { render, renderAlert, withInternalTracking } from "@packages/web-shell";
import { NEWSLETTER_LINKS_COUNT_PATH } from "./newsletter-links.url";

const { t, tPlural } = translator(inbox, DEFAULT_LOCALE);

const NEWSLETTER_LINKS_LINE_TEMPLATE = readFileSync(
	join(__dirname, "newsletter-links-line.template.html"),
	"utf-8",
);

const COUNT_ACTION = withInternalTracking(NEWSLETTER_LINKS_COUNT_PATH, {
	source: "inbox-emails",
	content: "remove-newsletter-links",
});

const RESTORE_ACTION = withInternalTracking(NEWSLETTER_LINKS_COUNT_PATH, {
	source: "inbox-emails",
	content: "restore-newsletter-links",
});

function resultSentences(params: {
	action: SavedLinksJobBulkAction;
	counts: SavedLinksJobCounts;
}): string[] {
	const { action, counts } = params;
	if (action === "restore") {
		const unrestorable = counts.unrestorable ?? 0;
		return [
			tPlural("newsletterLinks.line.result.restored", {
				count: counts.restored ?? 0,
			}),
			...(unrestorable > 0
				? [
						tPlural("newsletterLinks.line.result.unrestorable", {
							count: unrestorable,
						}),
					]
				: []),
		];
	}
	const skipped = REMOVAL_SKIP_REASONS.reduce(
		(total, reason) => total + (counts[reason] ?? 0),
		0,
	);
	return [
		tPlural("newsletterLinks.line.result.removed", { count: counts.held ?? 0 }),
		...(skipped > 0
			? [tPlural("newsletterLinks.line.result.skipped", { count: skipped })]
			: []),
		t("newsletterLinks.line.laterEmails"),
	];
}

function offerActions(params: { offer: boolean; restore: boolean }): {
	countAction: string | undefined;
	restoreAction: string | undefined;
	hasActions: boolean;
} {
	return {
		countAction: params.offer ? COUNT_ACTION : undefined,
		restoreAction: params.restore ? RESTORE_ACTION : undefined,
		hasActions: params.offer || params.restore,
	};
}

const NO_ACTIONS = {
	countAction: undefined,
	restoreAction: undefined,
	hasActions: false,
};

function lineView(line: Exclude<NewsletterLinksLine, { kind: "hidden" }>): {
	sentences: string[];
	working: string | undefined;
	failedAlertHtml: string | undefined;
	countAction: string | undefined;
	restoreAction: string | undefined;
	hasActions: boolean;
	pollUrl: string | undefined;
} {
	switch (line.kind) {
		case "offer":
			return {
				sentences: [
					line.offer
						? t("newsletterLinks.line.offer")
						: t("newsletterLinks.line.offerHeld"),
				],
				working: undefined,
				failedAlertHtml: undefined,
				...offerActions(line),
				pollUrl: undefined,
			};
		case "working":
			return {
				sentences: [],
				working: t(`newsletterLinks.line.working.${line.action}`),
				failedAlertHtml: undefined,
				...NO_ACTIONS,
				pollUrl: INBOX_PATH,
			};
		case "result":
			return {
				sentences: resultSentences(line),
				working: undefined,
				failedAlertHtml: undefined,
				...offerActions(line),
				pollUrl: undefined,
			};
		case "failed":
			return {
				sentences: [],
				working: undefined,
				failedAlertHtml: renderAlert({
					key: "newsletter-links-line-failed",
					content: {
						variant: "error",
						message: { text: t(`newsletterLinks.line.failed.${line.action}`) },
					},
				}),
				...offerActions(line),
				pollUrl: undefined,
			};
	}
}

export function renderNewsletterLinksLine(line: NewsletterLinksLine): string {
	if (line.kind === "hidden") return "";
	return render(NEWSLETTER_LINKS_LINE_TEMPLATE, {
		state: line.kind,
		...lineView(line),
	});
}
