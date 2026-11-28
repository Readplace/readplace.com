import {
	type NewsletterLinkRow,
	classifyForRemoval,
	isNewsletterIssueKey,
	isNewsletterLink,
	summariseNewsletterLinkRows,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	FindNewsletterIssueStates,
	ForEachRemovalCandidatePage,
	HasNewsletterLink,
	SummariseNewsletterLinks,
} from "@packages/provider-contracts/article-store";
import type { ListAllUserHighlights } from "@packages/provider-contracts/highlights";

export function initInMemoryRemovedLinks(deps: {
	readNewsletterLinkRows: (userId: UserId) => readonly NewsletterLinkRow[];
	listAllUserHighlights: ListAllUserHighlights;
}): {
	hasNewsletterLink: HasNewsletterLink;
	summariseNewsletterLinks: SummariseNewsletterLinks;
	findNewsletterIssueStates: FindNewsletterIssueStates;
	forEachRemovalCandidatePage: ForEachRemovalCandidatePage;
} {
	const hasNewsletterLink: HasNewsletterLink = async ({ userId }) =>
		deps.readNewsletterLinkRows(userId).some((row) => isNewsletterLink({ row, userId }));

	const summariseNewsletterLinks: SummariseNewsletterLinks = async ({ userId, cutoff }) => {
		const highlights = await deps.listAllUserHighlights(userId);
		return summariseNewsletterLinkRows({
			candidates: deps.readNewsletterLinkRows(userId).map((row) => ({ kind: "row", row })),
			userId,
			highlighted: new Set(highlights.map((highlight) => highlight.highlightOf)),
			cutoff,
		});
	};

	const findNewsletterIssueStates: FindNewsletterIssueStates = async ({ userId, cutoff }) => {
		const highlights = await deps.listAllUserHighlights(userId);
		const highlighted = new Set(highlights.map((highlight) => highlight.highlightOf));
		return new Map(
			deps
				.readNewsletterLinkRows(userId)
				.filter((row) => isNewsletterIssueKey({ storedKey: row.storedKey, userId }))
				.map((row) => [row.storedKey, classifyForRemoval({ row, userId, highlighted, cutoff, kind: "issue" })]),
		);
	};

	const forEachRemovalCandidatePage: ForEachRemovalCandidatePage = async ({ userId, onPage }) => {
		await onPage(
			deps
				.readNewsletterLinkRows(userId)
				.filter((row) => !isNewsletterIssueKey({ storedKey: row.storedKey, userId }))
				.map((row) => ({ kind: "row", row })),
		);
	};

	return {
		hasNewsletterLink,
		summariseNewsletterLinks,
		findNewsletterIssueStates,
		forEachRemovalCandidatePage,
	};
}
