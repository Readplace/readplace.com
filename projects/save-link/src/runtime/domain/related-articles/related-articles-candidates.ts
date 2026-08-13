import type { UserId } from "@packages/domain/user";
import type {
	FindRelatedCandidateArticles,
	FindRelatedReadCandidateArticles,
	RelatedCandidate,
} from "@packages/provider-contracts/related-articles";
import { RELATED_CANDIDATES_MAX } from "./related-articles-limits";

export interface RelatedCandidatePools {
	unreadCandidates: readonly RelatedCandidate[];
	readCandidates: readonly RelatedCandidate[];
	awaitingCrawl: number;
}

export type GatherRelatedCandidatePools = (params: {
	userId: UserId;
	excludeUrl: string;
}) => Promise<RelatedCandidatePools>;

export function initGatherRelatedCandidatePools(deps: {
	findRelatedCandidateArticles: FindRelatedCandidateArticles;
	findRelatedReadCandidateArticles: FindRelatedReadCandidateArticles;
}): { gatherRelatedCandidatePools: GatherRelatedCandidatePools } {
	const gatherRelatedCandidatePools: GatherRelatedCandidatePools = async ({
		userId,
		excludeUrl,
	}) => {
		const unread = await deps.findRelatedCandidateArticles({
			userId,
			excludeUrl,
			limit: RELATED_CANDIDATES_MAX,
		});
		const readLimit = RELATED_CANDIDATES_MAX - unread.candidates.length;
		if (readLimit === 0)
			return {
				unreadCandidates: unread.candidates,
				readCandidates: [],
				awaitingCrawl: unread.awaitingCrawl,
			};

		const read = await deps.findRelatedReadCandidateArticles({
			userId,
			excludeUrl,
			limit: readLimit,
		});
		return {
			unreadCandidates: unread.candidates,
			readCandidates: read.candidates,
			awaitingCrawl: unread.awaitingCrawl + read.awaitingCrawl,
		};
	};

	return { gatherRelatedCandidatePools };
}
