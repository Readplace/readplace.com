/** A saved article reduced to the fields the interest-matcher reasons over:
 * its hash id (used to look the article back up afterwards) plus the title and
 * a short blob of text — the generated summary, or the crawl excerpt as a
 * fallback. */
export interface ResurfaceCandidate {
	id: string;
	title: string;
	text: string;
}

/** Given the reader's free-text interest and their candidate articles, returns
 * the ids of the articles that match, ordered from most to least relevant. */
export type MatchArticlesByInterest = (params: {
	prompt: string;
	candidates: readonly ResurfaceCandidate[];
}) => Promise<{ matchedIds: string[] }>;
