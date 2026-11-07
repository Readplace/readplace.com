const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

export function sentenceBoundsAt(params: { text: string; offset: number }): { start: number; end: number } | undefined {
	const segment = sentences.segment(params.text).containing(Math.min(params.offset, params.text.length - 1));
	if (segment === undefined) return undefined;
	const sentence = segment.segment.trim();
	if (sentence.length === 0) return undefined;
	const start = segment.index + segment.segment.indexOf(sentence);
	return { start, end: start + sentence.length };
}
