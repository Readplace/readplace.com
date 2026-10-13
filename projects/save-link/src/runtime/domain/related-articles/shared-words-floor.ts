import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import type { RelatedArticleTarget, SelectRelatedArticles } from "./related-articles-selector";
import { scoreSharedWords } from "./shared-words-score";

export function initSelectRelatedArticlesAboveSharedWordsFloor(deps: {
	selectRelatedArticles: SelectRelatedArticles;
	floor: number;
	countsTowardFloor: (params: { target: RelatedArticleTarget; candidate: RelatedCandidate }) => boolean;
}): { selectRelatedArticles: SelectRelatedArticles } {
	const selectRelatedArticles: SelectRelatedArticles = async (params) => {
		const candidates = [...params.unreadCandidates, ...params.readCandidates];
		const scores = scoreSharedWords({ target: params.target, candidates });
		const bestScore = Math.max(0, ...scores.filter((_score, index) => deps.countsTowardFloor({ target: params.target, candidate: candidates[index] })));
		if (bestScore < deps.floor) {
			return { kind: "no-shared-words", bestScore, candidateCount: candidates.length };
		}
		return deps.selectRelatedArticles(params);
	};
	return { selectRelatedArticles };
}
