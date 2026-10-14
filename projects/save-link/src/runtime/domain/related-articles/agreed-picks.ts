import assert from "node:assert";
import type { SelectRelatedArticles } from "./related-articles-selector";
import {
	RELATED_REASON_MAX_CHARS,
	RELATED_RESULTS_MAX,
} from "./related-articles-limits";

export function initSelectAgreedPicks(deps: {
	selectRelatedArticles: SelectRelatedArticles;
}): { selectRelatedArticles: SelectRelatedArticles } {
	const selectRelatedArticles: SelectRelatedArticles = async (params) => {
		const first = await deps.selectRelatedArticles(params);
		if (first.kind !== "ready") return first;
		if (first.related.length === 0) {
			return { ...first, agreement: { agreed: 0, firstOnly: 0, laterOnly: 0 } };
		}
		const second = await deps.selectRelatedArticles(params);
		assert(second.kind === "ready", "repeat must return a selection");
		const unread = new Set(
			params.unreadCandidates.map((candidate) => candidate.url),
		);
		const secondRanks = new Map(
			second.related.map((pick, rank) => [pick.url, rank]),
		);
		const agreed = first.related.flatMap((pick, firstRank) => {
			const secondRank = secondRanks.get(pick.url);
			if (secondRank === undefined) return [];
			return [
				{
					url: pick.url,
					reason: (secondRank < firstRank
						? second.related[secondRank].reason
						: pick.reason
					).slice(0, RELATED_REASON_MAX_CHARS),
					firstRank,
					meanRank: (firstRank + secondRank) / 2,
					unread: unread.has(pick.url),
				},
			];
		});
		agreed.sort((a, b) => {
			if (a.unread !== b.unread) return a.unread ? -1 : 1;
			return a.meanRank - b.meanRank || a.firstRank - b.firstRank;
		});
		return {
			...first,
			related: agreed
				.slice(0, RELATED_RESULTS_MAX)
				.map(({ url, reason }) => ({ url, reason })),
			samples: [...first.samples, ...second.samples],
			agreement: {
				agreed: agreed.length,
				firstOnly: first.related.length - agreed.length,
				laterOnly: second.related.length - agreed.length,
			},
		};
	};
	return { selectRelatedArticles };
}
