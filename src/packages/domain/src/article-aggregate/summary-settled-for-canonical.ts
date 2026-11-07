import type { Article } from "./article.types";
import { isCanonicalCandidateRevoked, summaryMatchesCanonical } from "./content-selection.types";

export function isSummarySettledForCanonical(article: Article): boolean {
	if (isCanonicalCandidateRevoked(article.contentSelection)) return false;
	if (article.summary.kind === "skipped") return true;
	return article.summary.kind === "ready" && summaryMatchesCanonical({
		candidateId: article.contentSelection?.candidateId,
		summarySourceContentHash: article.summary.sourceContentHash,
		canonicalContentHash: article.freshness.canonicalContentHash,
	});
}
