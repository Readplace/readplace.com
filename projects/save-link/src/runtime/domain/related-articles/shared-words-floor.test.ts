import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import type { SelectRelatedArticlesParams, SelectRelatedResult } from "./related-articles-selector";
import { initSelectRelatedArticlesWithoutSharedBoilerplate } from "./shared-boilerplate";
import { initSelectRelatedArticlesAboveSharedWordsFloor } from "./shared-words-floor";
import { scoreSharedWords } from "./shared-words-score";

const target = { title: "Kubernetes operator reconciliation", description: "Cluster state loops", siteName: "Example" };
const candidates: RelatedCandidate[] = Array.from({ length: 30 }, (_, index) => ({
	url: `https://example.com/bread-${index}`,
	title: "Sourdough fermentation",
	description: "Baking bread and hydration",
	siteName: "Example",
}));
const ownCopy = { ...target, url: "https://mirror.example.com/operator" };
const ready: SelectRelatedResult = { kind: "ready", related: [], inputTokens: 10, outputTokens: 2, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0 };

describe("initSelectRelatedArticlesAboveSharedWordsFloor", () => {
	it("skips below the floor without calling the selector", async () => {
		const inner = jest.fn(async () => ready);
		const { selectRelatedArticles } = initSelectRelatedArticlesAboveSharedWordsFloor({ selectRelatedArticles: inner, floor: 8 });
		expect(await selectRelatedArticles({ target, unreadCandidates: [], readCandidates: candidates }))
			.toEqual({ kind: "no-shared-words", bestScore: 0, candidateCount: candidates.length });
		expect(inner).not.toHaveBeenCalled();
	});

	it("gives an empty pool score zero", async () => {
		const inner = jest.fn(async () => ready);
		const { selectRelatedArticles } = initSelectRelatedArticlesAboveSharedWordsFloor({ selectRelatedArticles: inner, floor: 8 });
		expect(await selectRelatedArticles({ target, unreadCandidates: [], readCandidates: [] }))
			.toEqual({ kind: "no-shared-words", bestScore: 0, candidateCount: 0 });
		expect(inner).not.toHaveBeenCalled();
	});

	it("passes at and above the floor with the original params and result", async () => {
		const params: SelectRelatedArticlesParams = { target, unreadCandidates: candidates, readCandidates: [ownCopy] };
		const bestScore = Math.max(...scoreSharedWords({ target, candidates: [...candidates, ownCopy] }));
		expect(bestScore).toBeGreaterThan(8);
		for (const floor of [bestScore, bestScore - 1]) {
			const inner = jest.fn(async () => ready);
			const { selectRelatedArticles } = initSelectRelatedArticlesAboveSharedWordsFloor({ selectRelatedArticles: inner, floor });
			expect(await selectRelatedArticles(params)).toBe(ready);
			expect(inner).toHaveBeenCalledWith(params);
		}
	});

	it("runs after shared boilerplate is removed and preserves the target block-page result", async () => {
		const inner = jest.fn(async () => ready);
		const { selectRelatedArticles } = initSelectRelatedArticlesWithoutSharedBoilerplate(
			initSelectRelatedArticlesAboveSharedWordsFloor({ selectRelatedArticles: inner, floor: 8 }),
		);
		const block = { url: "https://blocked.example.com", title: "Access denied", description: "Please enable cookies", siteName: "Blocked" };
		const mirror = { ...block, url: "https://other.example.com", siteName: "Other" };
		expect(await selectRelatedArticles({ target, unreadCandidates: [block, mirror], readCandidates: candidates }))
			.toEqual({ kind: "no-shared-words", bestScore: 0, candidateCount: candidates.length });
		expect(await selectRelatedArticles({ target: block, unreadCandidates: [], readCandidates: [mirror] }))
			.toEqual({ kind: "shared-boilerplate" });
		expect(inner).not.toHaveBeenCalled();
	});
});
