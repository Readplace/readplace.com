import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { CoverageInspection, ParseHtml } from "@packages/article-parser";
import type { CoverageOutcome } from "@packages/domain/article";
import type { DownloadMedia } from "./download-media.types";
import { initFinalizeArticle, type ProcessContent } from "./finalize-article";

const SOURCE_HTML = "<html><body><h2>Part one</h2><p>One.</p><h2>Part two</h2><p>Two.</p></body></html>";
const BASELINE = "<h2>Part one</h2><p>One.</p>";
const RECOVERED = "<h2>Part one</h2><p>One.</p><h2>Part two</h2><p>Two.</p>";

const sectionVerify = ({ readerHtml }: { readerHtml: string }): CoverageOutcome =>
	readerHtml.includes("Part two")
		? { outcome: "verified-for-scope", scope: { kind: "article", units: 2 }, covered: 2 }
		: { outcome: "known-partial", scope: { kind: "article", units: 2 }, covered: 1, unresolved: 1, reasons: ["missing-section"] };

function sectionInspection(mode: "shadow" | "enforce"): CoverageInspection {
	return {
		ruleId: "section-coverage",
		ruleVersion: 1,
		mode,
		kind: "inspected",
		verify: sectionVerify,
		alternative: () => ({ content: RECOVERED, wordCount: 42 }),
	};
}

function parseHtmlWith(coverage: readonly CoverageInspection[]): ParseHtml {
	return () => ({
		ok: true,
		coverage,
		article: { title: "T", siteName: "example.com", excerpt: "e", wordCount: 7, content: BASELINE, imageUrl: undefined },
	});
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

async function finalizeWith(deps: {
	coverage: readonly CoverageInspection[];
	downloadMedia?: DownloadMedia;
	processContent?: ProcessContent;
}) {
	const downloadMedia = jest.fn(deps.downloadMedia ?? (async () => []));
	const finalize = initFinalizeArticle({
		parseHtml: parseHtmlWith(deps.coverage),
		downloadMedia,
		processContent: deps.processContent ?? (async ({ html }) => html),
		fetchThumbnailImage: async ({ candidates }) => ({ image: undefined, provenUnusable: [], fetched: candidates }),
		putImageObject: async () => {},
		imagesCdnBaseUrl: "https://cdn.example.com",
	});
	const result = await finalize({ url: "https://example.com/guide", documentUrl: "https://example.com/guide", html: SOURCE_HTML });
	assert(result.ok, "the article finalizes");
	return { article: result.article, downloadedBodies: downloadMedia.mock.calls.map(([call]) => call.html) };
}

describe("initFinalizeArticle coverage repair", () => {
	it("keeps the baseline and records a repair a shadow rule would apply", async () => {
		const { article, downloadedBodies } = await finalizeWith({ coverage: [sectionInspection("shadow")] });

		expect(downloadedBodies).toEqual([BASELINE]);
		expect(article.html).toBe(BASELINE);
		expect(article.metadata.wordCount).toBe(7);
		expect(article.metadata.coverage).toEqual({
			schemaVersion: 1,
			sourceDigest: sha256(SOURCE_HTML),
			outputDigest: sha256(BASELINE),
			assessments: [
				{
					ruleId: "section-coverage",
					ruleVersion: 1,
					mode: "shadow",
					repair: "would-apply",
					outcome: "known-partial",
					scope: { kind: "article", units: 2 },
					covered: 1,
					unresolved: 1,
					reasons: ["missing-section"],
				},
			],
		});
	});

	it("applies an enforced repair that verifies after media", async () => {
		const abstained: CoverageInspection = {
			ruleId: "section-coverage",
			ruleVersion: 1,
			mode: "shadow",
			kind: "abstained",
			reason: "no-section-structure",
		};
		const { article, downloadedBodies } = await finalizeWith({ coverage: [sectionInspection("enforce"), abstained] });

		expect(downloadedBodies).toEqual([RECOVERED]);
		expect(article.html).toBe(RECOVERED);
		expect(article.metadata.wordCount).toBe(42);
		expect(article.metadata.coverage?.outputDigest).toBe(sha256(RECOVERED));
		expect(article.metadata.coverage?.assessments).toEqual([
			{
				ruleId: "section-coverage",
				ruleVersion: 1,
				mode: "enforce",
				repair: "applied",
				outcome: "verified-for-scope",
				scope: { kind: "article", units: 2 },
				covered: 2,
			},
			{
				ruleId: "section-coverage",
				ruleVersion: 1,
				mode: "shadow",
				repair: "none",
				outcome: "unknown",
				reasons: ["no-section-structure"],
			},
		]);
	});

	it("falls back to the baseline when media for the repair fails", async () => {
		const { article, downloadedBodies } = await finalizeWith({
			coverage: [sectionInspection("enforce")],
			downloadMedia: async ({ html }) => {
				assert(!html.includes("Part two"), new Error("media broke"));
				return [];
			},
		});

		expect(downloadedBodies).toEqual([RECOVERED, BASELINE]);
		expect(article.html).toBe(BASELINE);
		expect(article.metadata.wordCount).toBe(7);
		expect(article.metadata.coverage?.assessments.map(({ repair, outcome }) => ({ repair, outcome }))).toEqual([
			{ repair: "media-failed", outcome: "known-partial" },
		]);
	});

	it("falls back to the baseline when the repair no longer verifies after media", async () => {
		const { article, downloadedBodies } = await finalizeWith({
			coverage: [sectionInspection("enforce")],
			processContent: async ({ html }) => html.replace("<h2>Part two</h2>", ""),
		});

		expect(downloadedBodies).toEqual([RECOVERED, BASELINE]);
		expect(article.html).toBe(BASELINE);
		expect(article.metadata.coverage?.assessments.map(({ repair }) => repair)).toEqual(["regressed"]);
	});

	it("falls back to the baseline when the repair worsens another rule's outcome", async () => {
		const chapterRule: CoverageInspection = {
			ruleId: "section-coverage",
			ruleVersion: 1,
			mode: "shadow",
			kind: "inspected",
			verify: ({ readerHtml }) =>
				readerHtml.includes("Part two")
					? { outcome: "known-partial", scope: { kind: "chapter", units: 2 }, covered: 1, unresolved: 1, reasons: ["missing-section"] }
					: { outcome: "verified-for-scope", scope: { kind: "chapter", units: 1 }, covered: 1 },
			alternative: undefined,
		};
		const { article } = await finalizeWith({ coverage: [sectionInspection("enforce"), chapterRule] });

		expect(article.html).toBe(BASELINE);
		expect(article.metadata.coverage?.assessments.map(({ repair, outcome }) => ({ repair, outcome }))).toEqual([
			{ repair: "regressed", outcome: "known-partial" },
			{ repair: "none", outcome: "verified-for-scope" },
		]);
	});

	it("records no coverage when no rule inspected the page", async () => {
		const { article } = await finalizeWith({ coverage: [] });

		expect(article.metadata).not.toHaveProperty("coverage");
	});
});
