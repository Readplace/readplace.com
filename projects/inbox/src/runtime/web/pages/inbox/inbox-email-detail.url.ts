import { z } from "zod";
import { EMAIL_FEATURE } from "@packages/web-shell";
import { ARTICLES_PAGE_SIZE } from "./inbox-articles-more.url";
import { INBOX_PATH } from "./inbox-emails.url";

export const MAIL_TAB_KEYS = ["view", "articles"] as const;

export type MailTabKey = (typeof MAIL_TAB_KEYS)[number];

const DEFAULT_MAIL_TAB: MailTabKey = "view";

const MailTabSchema = z.enum(MAIL_TAB_KEYS).catch(DEFAULT_MAIL_TAB);

export function parseMailTab(tab: unknown): MailTabKey {
	return MailTabSchema.parse(tab);
}

export function buildInboxEmailDetailUrl(state: {
	emailId: string;
	tab: MailTabKey;
	shown?: number;
}): string {
	const params = new URLSearchParams();
	params.set("feature", EMAIL_FEATURE);
	if (state.tab !== DEFAULT_MAIL_TAB) {
		params.set("tab", state.tab);
	}
	if (state.shown !== undefined && state.shown > ARTICLES_PAGE_SIZE) {
		params.set("shown", String(state.shown));
	}
	return `${INBOX_PATH}/${encodeURIComponent(state.emailId)}?${params.toString()}`;
}
