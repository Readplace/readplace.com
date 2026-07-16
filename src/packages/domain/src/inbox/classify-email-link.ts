import type { EmailLinkSkipReason } from "./inbox-email-link.schema";
import { isListUnsubscribeTarget } from "./list-unsubscribe";

export interface EmailLinkContext {
	url: string;
	listUnsubscribeUrls: string[];
}

export type EmailLinkClassification =
	| { action: "crawl" }
	| { action: "skip"; reason: EmailLinkSkipReason };

const EXCLUSION_RULES: ReadonlyArray<{
	reason: EmailLinkSkipReason;
	matches: (link: EmailLinkContext) => boolean;
}> = [{ reason: "list-unsubscribe", matches: isListUnsubscribeTarget }];

/** Decides whether one extracted email link is safe to preview-crawl. A `skip`
 * verdict means a GET may act on the reader's behalf (unsubscribe, confirm), so
 * the link must never be fetched — misses fail open to `crawl`. */
export function classifyEmailLink(link: EmailLinkContext): EmailLinkClassification {
	const matched = EXCLUSION_RULES.find((rule) => rule.matches(link));
	if (matched === undefined) return { action: "crawl" };
	return { action: "skip", reason: matched.reason };
}
