import { inboxEmailPath } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { z } from "zod";
import { ARTICLES_PAGE_SIZE } from "./inbox-articles-more.url";
import {
	type InboxEmailFilter,
	writeInboxEmailFilter,
} from "./inbox-email-filter";

export const MAIL_TAB_KEYS = ["view", "articles", "excluded"] as const;

export type MailTabKey = (typeof MAIL_TAB_KEYS)[number];

const DEFAULT_MAIL_TAB: MailTabKey = "view";

const MailTabSchema = z.enum(MAIL_TAB_KEYS).catch(DEFAULT_MAIL_TAB);

export function parseMailTab(tab: unknown): MailTabKey {
	return MailTabSchema.parse(tab);
}

const InboxEmailFilterSchema = z
	.looseObject({
		readlist: ReadlistSlugSchema.optional().catch(undefined),
		show: z.enum(["fit", "rest"]).optional().catch(undefined),
	})
	.catch({});

export function parseInboxEmailFilter(
	query: unknown,
): InboxEmailFilter | undefined {
	const { readlist, show } = InboxEmailFilterSchema.parse(query);
	if (readlist === undefined || show === undefined) return undefined;
	return { readlist, show };
}

export type InboxEmailPageState = {
	tab: MailTabKey;
	shown?: number;
	filter?: InboxEmailFilter;
};

export function inboxEmailPageStateQuery(state: InboxEmailPageState): string {
	const params = new URLSearchParams();
	if (state.tab !== DEFAULT_MAIL_TAB) {
		params.set("tab", state.tab);
	}
	if (state.shown !== undefined && state.shown > ARTICLES_PAGE_SIZE) {
		params.set("shown", String(state.shown));
	}
	writeInboxEmailFilter({ search: params, filter: state.filter });
	return params.toString();
}

export function buildInboxEmailDetailUrl(
	state: InboxEmailPageState & { emailId: string },
): string {
	const query = inboxEmailPageStateQuery(state);
	const path = inboxEmailPath(state.emailId);
	return query === "" ? path : `${path}?${query}`;
}
