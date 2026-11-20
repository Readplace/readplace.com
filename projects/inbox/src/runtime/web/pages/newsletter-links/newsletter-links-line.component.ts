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
import { render, withInternalTracking } from "@packages/web-shell";
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

function lineView(line: Exclude<NewsletterLinksLine, { kind: "hidden" }>): {
	sentences: string[];
	countAction: string | undefined;
	pollUrl: string | undefined;
} {
	switch (line.kind) {
		case "offer":
			return {
				sentences: [t("newsletterLinks.line.offer")],
				countAction: COUNT_ACTION,
				pollUrl: undefined,
			};
		case "working":
			return {
				sentences: [t(`newsletterLinks.line.working.${line.action}`)],
				countAction: undefined,
				pollUrl: INBOX_PATH,
			};
		case "result":
			return {
				sentences: resultSentences(line),
				countAction: line.offer ? COUNT_ACTION : undefined,
				pollUrl: undefined,
			};
		case "failed":
			return {
				sentences: [t(`newsletterLinks.line.failed.${line.action}`)],
				countAction: line.offer ? COUNT_ACTION : undefined,
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
