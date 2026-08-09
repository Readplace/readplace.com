import assert from "node:assert";

export type ArticleSize = "small" | "large";

export type ArticleFixture = {
	size: ArticleSize;
	paragraphs: number;
	wordsPerParagraph: number;
};

export const ARTICLE_FIXTURES: Record<ArticleSize, ArticleFixture> = {
	small: { size: "small", paragraphs: 6, wordsPerParagraph: 60 },
	large: { size: "large", paragraphs: 120, wordsPerParagraph: 70 },
};

const FIXTURE_VOCABULARY = [
	"reading",
	"queue",
	"article",
	"latency",
	"browser",
	"render",
	"layout",
	"paint",
];

export const ARTICLE_END_MARKER = "article-open-perf-end-of-body";
export const ARTICLE_END_MARKER_SELECTOR = "mark";

export function articleWordCount(fixture: ArticleFixture): number {
	return fixture.paragraphs * fixture.wordsPerParagraph + 1;
}

/** Generated rather than checked in as a file so both arms are handed
 * byte-identical bodies from the same declaration, and so the only difference
 * between the small and the large cell is how much of it there is. */
export function buildArticleHtml(fixture: ArticleFixture): string {
	const paragraphs = Array.from({ length: fixture.paragraphs }, (_paragraph, index) => {
		const words = Array.from(
			{ length: fixture.wordsPerParagraph },
			(_word, position) =>
				FIXTURE_VOCABULARY[(index + position) % FIXTURE_VOCABULARY.length],
		);
		return `<p>${words.join(" ")}</p>`;
	});
	return `${paragraphs.join("")}<p><mark>${ARTICLE_END_MARKER}</mark></p>`;
}

export type NetworkShape = {
	latencyMs: number;
	downloadBytesPerSecond: number;
	uploadBytesPerSecond: number;
};

export type OpenCondition = {
	name: string;
	article: ArticleSize;
	cpuRate: number;
	network: NetworkShape | undefined;
};

const SLOW_MOBILE: NetworkShape = {
	latencyMs: 150,
	downloadBytesPerSecond: 500_000,
	uploadBytesPerSecond: 125_000,
};

export const ARTICLE_OPEN_CONDITIONS: readonly OpenCondition[] = [
	{ name: "loopback-cpu1x-small", article: "small", cpuRate: 1, network: undefined },
	{ name: "loopback-cpu4x-small", article: "small", cpuRate: 4, network: undefined },
	{ name: "loopback-cpu6x-small", article: "small", cpuRate: 6, network: undefined },
	{ name: "loopback-cpu1x-large", article: "large", cpuRate: 1, network: undefined },
	{ name: "loopback-cpu4x-large", article: "large", cpuRate: 4, network: undefined },
	{ name: "loopback-cpu6x-large", article: "large", cpuRate: 6, network: undefined },
	{ name: "slow-mobile-small", article: "small", cpuRate: 4, network: SLOW_MOBILE },
	{ name: "slow-mobile-large", article: "large", cpuRate: 4, network: SLOW_MOBILE },
];

export type CpuThrottling = { rate: number };

export type NetworkEmulation = {
	offline: boolean;
	latency: number;
	downloadThroughput: number;
	uploadThroughput: number;
};

export const UNTHROTTLED = {
	cpu: { rate: 1 },
	network: {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	},
} satisfies { cpu: CpuThrottling; network: NetworkEmulation };

export function cpuThrottlingFor(condition: OpenCondition): CpuThrottling {
	assert(
		condition.cpuRate >= 1,
		`a cpu rate below 1 speeds the browser up, which no device does: ${condition.name} asks for ${condition.cpuRate}`,
	);
	return { rate: condition.cpuRate };
}

export function networkEmulationFor(condition: OpenCondition): NetworkEmulation {
	const shape = condition.network;
	if (shape === undefined) return UNTHROTTLED.network;
	return {
		offline: false,
		latency: shape.latencyMs,
		downloadThroughput: shape.downloadBytesPerSecond,
		uploadThroughput: shape.uploadBytesPerSecond,
	};
}
