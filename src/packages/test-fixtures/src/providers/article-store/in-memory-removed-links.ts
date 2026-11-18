import {
	type NewsletterLinkRow,
	isNewsletterLink,
	summariseNewsletterLinkRows,
} from "@packages/domain/article";
import { emailIssueKeyPrefix } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type {
	CountNewsletterIssues,
	HasNewsletterLink,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import type { ListAllUserHighlights } from "@packages/provider-contracts/highlights";

export function initInMemoryRemovedLinks(deps: {
	readNewsletterLinkRows: (userId: UserId) => readonly NewsletterLinkRow[];
	readOpenedInReadlists: (userId: UserId) => ReadonlySet<string>;
	listAllUserHighlights: ListAllUserHighlights;
}): {
	hasNewsletterLink: HasNewsletterLink;
	summariseNewsletterLinks: SummariseNewsletterLinks;
	countNewsletterIssues: CountNewsletterIssues;
} {
	const hasNewsletterLink: HasNewsletterLink = async ({ userId }) =>
		deps.readNewsletterLinkRows(userId).some((row) => isNewsletterLink({ row, userId }));

	const summariseNewsletterLinks: SummariseNewsletterLinks = async ({ userId, cutoff }) => {
		const highlights = await deps.listAllUserHighlights(userId);
		return summariseNewsletterLinkRows({
			candidates: deps.readNewsletterLinkRows(userId).map((row) => ({ kind: "row", row })),
			userId,
			highlighted: new Set(highlights.map((highlight) => highlight.highlightOf)),
			openedInReadlists: deps.readOpenedInReadlists(userId),
			cutoff,
		});
	};

	const countNewsletterIssues: CountNewsletterIssues = async ({ userId }) =>
		deps.readNewsletterLinkRows(userId).filter((row) => row.storedKey.startsWith(emailIssueKeyPrefix(userId))).length;

	return { hasNewsletterLink, summariseNewsletterLinks, countNewsletterIssues };
}
