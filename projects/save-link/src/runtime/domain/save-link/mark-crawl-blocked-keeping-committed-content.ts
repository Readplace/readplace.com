import {
	type MarkCrawlBlockedInput,
	markCrawlBlocked,
	recrawlTieKeptCanonical,
	type Transition,
} from "@packages/domain/article-aggregate";
import { holdsCommittedContent } from "../select-content/holds-committed-content";

export const markCrawlBlockedKeepingCommittedContent: Transition<MarkCrawlBlockedInput & { now: string }> = (article, input) =>
	holdsCommittedContent(article)
		? recrawlTieKeptCanonical(article, { now: input.now })
		: markCrawlBlocked(article, { reason: input.reason });
