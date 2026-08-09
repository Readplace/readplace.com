import { parseHTML } from "linkedom";
import {
	ARTICLE_END_MARKER,
	ARTICLE_END_MARKER_SELECTOR,
	ARTICLE_FIXTURES,
	ARTICLE_OPEN_CONDITIONS,
	UNTHROTTLED,
	articleWordCount,
	buildArticleHtml,
	cpuThrottlingFor,
	networkEmulationFor,
} from "./article-open-conditions";

describe("buildArticleHtml", () => {
	it("builds one paragraph per declared paragraph plus the end marker's own", () => {
		const { document } = parseHTML(
			`<body>${buildArticleHtml({ size: "small", paragraphs: 4, wordsPerParagraph: 3 })}</body>`,
		);

		expect(document.querySelectorAll("p")).toHaveLength(5);
	});

	it("fills every paragraph with the declared number of words", () => {
		const { document } = parseHTML(
			`<body>${buildArticleHtml({ size: "small", paragraphs: 2, wordsPerParagraph: 3 })}</body>`,
		);

		expect(
			Array.from(document.querySelectorAll("p")).map(
				(paragraph) => paragraph.textContent?.split(" ").length,
			),
		).toEqual([3, 3, 1]);
	});

	it("ends the body with the marker both arms have to deliver in full to lay out", () => {
		const { document } = parseHTML(
			`<body>${buildArticleHtml({ size: "small", paragraphs: 3, wordsPerParagraph: 3 })}</body>`,
		);
		const paragraphs = Array.from(document.querySelectorAll("p"));

		expect(paragraphs[paragraphs.length - 1].innerHTML).toBe(
			`<${ARTICLE_END_MARKER_SELECTOR}>${ARTICLE_END_MARKER}</${ARTICLE_END_MARKER_SELECTOR}>`,
		);
	});

	it("carries exactly one end marker, so the probe cannot settle on an earlier one", () => {
		const { document } = parseHTML(
			`<body>${buildArticleHtml(ARTICLE_FIXTURES.large)}</body>`,
		);

		expect(document.querySelectorAll(ARTICLE_END_MARKER_SELECTOR)).toHaveLength(1);
	});

	it("hands both arms the same bytes for the same fixture", () => {
		expect(buildArticleHtml(ARTICLE_FIXTURES.small)).toBe(
			buildArticleHtml(ARTICLE_FIXTURES.small),
		);
	});

	it("makes the large fixture the bigger body of the two", () => {
		expect(buildArticleHtml(ARTICLE_FIXTURES.large).length).toBeGreaterThan(
			buildArticleHtml(ARTICLE_FIXTURES.small).length,
		);
	});
});

describe("articleWordCount", () => {
	it("counts every word the built body carries", () => {
		const fixture = { size: "small", paragraphs: 3, wordsPerParagraph: 5 } as const;
		const { document } = parseHTML(`<body>${buildArticleHtml(fixture)}</body>`);
		const words = Array.from(document.querySelectorAll("p")).reduce(
			(total, paragraph) => total + (paragraph.textContent ?? "").split(" ").length,
			0,
		);

		expect(articleWordCount(fixture)).toBe(words);
	});
});

describe("cpuThrottlingFor", () => {
	it("passes a condition's slowdown straight to the emulation payload", () => {
		expect(
			cpuThrottlingFor({
				name: "loopback-cpu6x-small",
				article: "small",
				cpuRate: 6,
				network: undefined,
			}),
		).toEqual({ rate: 6 });
	});

	it("refuses a rate that would make the browser faster than the host", () => {
		expect(() =>
			cpuThrottlingFor({
				name: "impossible",
				article: "small",
				cpuRate: 0.5,
				network: undefined,
			}),
		).toThrow(
			"a cpu rate below 1 speeds the browser up, which no device does: impossible asks for 0.5",
		);
	});
});

describe("networkEmulationFor", () => {
	it("leaves loopback unshaped so a condition without a network is the raw link", () => {
		expect(
			networkEmulationFor({
				name: "loopback-cpu1x-small",
				article: "small",
				cpuRate: 1,
				network: undefined,
			}),
		).toEqual(UNTHROTTLED.network);
	});

	it("shapes a condition that declares a network into throughput bytes and latency", () => {
		expect(
			networkEmulationFor({
				name: "slow-mobile-small",
				article: "small",
				cpuRate: 4,
				network: {
					latencyMs: 150,
					downloadBytesPerSecond: 500_000,
					uploadBytesPerSecond: 125_000,
				},
			}),
		).toEqual({
			offline: false,
			latency: 150,
			downloadThroughput: 500_000,
			uploadThroughput: 125_000,
		});
	});
});

describe("ARTICLE_OPEN_CONDITIONS", () => {
	it("names every condition once, so two cells cannot overwrite each other's row", () => {
		const names = ARTICLE_OPEN_CONDITIONS.map((condition) => condition.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it("measures every declared article size under every declared cpu rate", () => {
		const loopback = ARTICLE_OPEN_CONDITIONS.filter(
			(condition) => condition.network === undefined,
		).map((condition) => `${condition.article}@${condition.cpuRate}x`);

		expect(loopback).toEqual([
			"small@1x",
			"small@4x",
			"small@6x",
			"large@1x",
			"large@4x",
			"large@6x",
		]);
	});

	it("emulates a slow mobile link on both article sizes", () => {
		expect(
			ARTICLE_OPEN_CONDITIONS.filter(
				(condition) => condition.network !== undefined,
			).map((condition) => [condition.article, condition.network?.latencyMs]),
		).toEqual([
			["small", 150],
			["large", 150],
		]);
	});
});
