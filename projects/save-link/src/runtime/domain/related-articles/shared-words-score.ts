import { RELATED_CANDIDATE_TEXT_MAX_CHARS } from "./related-articles-limits";

const STOP_WORDS = new Set(`the a an and or of to in on for with from by as at is are was were be been it its this that these those both about into over under than then their there they them his her our your you we he she not but also how why what when who which while more most less very can could would should will just only one two new other another same each between through after before during via vs has have had do does did get got make makes made use used using like`.split(/\s+/));
type SharedWordsArticle = { title: string; description: string };

function wordsOf(article: SharedWordsArticle): string[] {
	const title = Array.from(article.title).slice(0, RELATED_CANDIDATE_TEXT_MAX_CHARS).join("");
	const description = Array.from(article.description).slice(0, RELATED_CANDIDATE_TEXT_MAX_CHARS).join("");
	return (`${title} ${title} ${description}`.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) ?? [])
		.filter((word) => word.length >= 2 && !STOP_WORDS.has(word))
		.map((word) => word.slice(0, 7));
}

export function scoreSharedWords(params: {
	target: SharedWordsArticle;
	candidates: readonly SharedWordsArticle[];
}): number[] {
	const documents = params.candidates.map(wordsOf);
	const frequencies = documents.map((words) => {
		const counts = new Map<string, number>();
		for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
		return { counts, length: words.length };
	});
	const query = [...new Set(wordsOf(params.target))].map((word) => ({
		word,
		documentFrequency: frequencies.filter((document) => document.counts.has(word)).length,
	}));
	const averageLength = documents.reduce((sum, words) => sum + words.length, 0) / documents.length;
	return frequencies.map((document) => {
		let score = 0;
		for (const { word, documentFrequency } of query) {
			const frequency = document.counts.get(word);
			if (frequency === undefined) continue;
			const idf = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
			score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * document.length / averageLength));
		}
		return score;
	});
}
