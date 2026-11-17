import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import { render } from "@packages/web-shell";

const { t } = translator(inbox, DEFAULT_LOCALE);

const INBOX_EXCLUDED_LINK_MOVED_TEMPLATE = readFileSync(
	join(__dirname, "inbox-excluded-link-moved.template.html"),
	"utf-8",
);

export function renderInboxExcludedLinkMoved(input: {
	ordinal: string;
	url: string;
	articlesHref: string;
}): string {
	return render(INBOX_EXCLUDED_LINK_MOVED_TEMPLATE, {
		...input,
		domId: `inbox-skipped-${input.ordinal}`,
		notice: t("excludedLink.moved.notice"),
		linkLabel: t("excludedLink.moved.link"),
	});
}

export function buildSavedAsArticleAnnouncement(input: { url: string }): string {
	return t("liveStatus.savedAsArticle", { url: input.url });
}
