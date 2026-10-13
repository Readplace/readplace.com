import type { SelectRelatedArticles } from "./related-articles-selector";
import { scoreSharedWords } from "./shared-words-score";

export function initSelectRelatedArticlesAboveSharedWordsFloor(deps: {
	selectRelatedArticles: SelectRelatedArticles;
	floor: number;
}): { selectRelatedArticles: SelectRelatedArticles } {
	const selectRelatedArticles: SelectRelatedArticles = async (params) => {
		const candidates = [...params.unreadCandidates, ...params.readCandidates];
		const bestScore = Math.max(0, ...scoreSharedWords({ target: params.target, candidates }));
		if (bestScore < deps.floor) {
			return { kind: "no-shared-words", bestScore, candidateCount: candidates.length };
		}
		return deps.selectRelatedArticles(params);
	};
	return { selectRelatedArticles };
}
