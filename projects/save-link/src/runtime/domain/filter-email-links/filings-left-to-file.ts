import type { EventInstant } from "@packages/domain/event-envelope";
import type { EmailLinkOrdinal } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import type {
	FindReadlistRemoval,
	FindSavedArticleForLink,
	ListReadlistFitOverrides,
} from "@packages/provider-contracts/article-store";

export function initFilingsLeftToFile(deps: {
	listReadlistFitOverrides: ListReadlistFitOverrides;
	findSavedArticleForLink: FindSavedArticleForLink;
	findReadlistRemoval: FindReadlistRemoval;
	logger: Logger;
}) {
	const removedAfterTriage = async (input: {
		userId: UserId;
		readlist: ReadlistSlug;
		url: string;
		triagedAt: EventInstant;
	}): Promise<boolean> => {
		const { userId, readlist, url, triagedAt } = input;
		const found = await deps.findSavedArticleForLink({ userId, url });
		if (found.kind === "not-saved") return false;
		const removedAt = await deps.findReadlistRemoval({ userId, readlist, url: found.article.url });
		return removedAt !== undefined && removedAt > triagedAt;
	};

	return async <Filing extends { ordinal: EmailLinkOrdinal; url: string }>(input: {
		userId: UserId;
		readlist: ReadlistSlug;
		receivedAtMessageId: string;
		triagedAt: EventInstant;
		filings: Filing[];
	}): Promise<Filing[]> => {
		const { userId, readlist, receivedAtMessageId, triagedAt, filings } = input;
		if (filings.length === 0) return filings;
		const overrides = await deps.listReadlistFitOverrides({ userId, readlist });
		const chosen = new Set(
			overrides
				.filter((override) => override.receivedAtMessageId === receivedAtMessageId)
				.map((override) => override.ordinal),
		);
		const left: Filing[] = [];
		for (const filing of filings.filter((candidate) => !chosen.has(candidate.ordinal))) {
			if (await removedAfterTriage({ userId, readlist, url: filing.url, triagedAt })) {
				deps.logger.info("[filter-email-links] filing withheld", {
					userId,
					readlist,
					receivedAtMessageId,
					ordinal: filing.ordinal,
					reason: "removed-after-triage",
				});
				continue;
			}
			left.push(filing);
		}
		return left;
	};
}
