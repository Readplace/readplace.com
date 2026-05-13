const WORDS_PER_MINUTE = 238;

export function estimatedReadTimeFromWordCount(wordCount: number): number {
	return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}
