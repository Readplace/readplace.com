export type TimedMediaFacts = Readonly<{
	durationSeconds: number;
	hasAudio: boolean;
	hasVideo: boolean;
}>;

export function isPlayableAudio(facts: TimedMediaFacts): boolean {
	return facts.hasAudio && !facts.hasVideo && facts.durationSeconds >= 1;
}
