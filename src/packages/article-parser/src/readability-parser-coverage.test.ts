import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_COVERAGE_RULES_OFF } from "@packages/domain/article";
import { noExtract, noRecovery, noTransform, skipCrawl, type SiteRules } from "@packages/site-rules";
import type { ReadabilityAdditions } from "./article-parser.types";
import type { ActiveCoverageRules, CoverageInspection, SourceInspection } from "./coverage-rules/coverage-rule.types";
import { activateCoverageRules, initArticleCoverageRules } from "./coverage-rules/coverage-rules";
import { planCoverageRepair } from "./coverage-rules/plan-coverage-repair";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const ARTICLE_HTML = `<html><head><title>Coverage Page</title></head><body><article>
<h1>Coverage Page</h1>
<p>This is the first paragraph of the article with enough text to be meaningful content for readability extraction.</p>
<p>This is the second paragraph with additional content that helps readability determine this is a real article worth parsing.</p>
</article></body></html>`;

const ASSESSED = { ruleId: "section-coverage", ruleVersion: 1, mode: "shadow" } as const;

function inspectedSource(overrides: Partial<Extract<SourceInspection, { kind: "inspected" }>> = {}): SourceInspection {
	return {
		...ASSESSED,
		kind: "inspected",
		verify: () => ({ outcome: "verified-for-scope", scope: { kind: "article", units: 3 }, covered: 3 }),
		recoveredBodyHtml: undefined,
		...overrides,
	};
}

function initParser(deps: {
	coverageRules: ActiveCoverageRules;
	siteRules?: readonly Partial<SiteRules>[];
	readabilityAdditions?: Partial<ReadabilityAdditions>;
	logError?: (message: string, error?: Error) => void;
}) {
	return initReadabilityParser({
		crawlArticle: async () => ({ status: "fetched", html: ARTICLE_HTML, bodyHash: "a".repeat(64) }),
		siteRules: (deps.siteRules ?? []).map((site) => ({
			matches: () => false,
			onCrawl: skipCrawl,
			recoverContent: noRecovery,
			extract: noExtract,
			transform: noTransform,
			...site,
		})),
		readabilityAdditions: { ...readabilityAdditions, ...deps.readabilityAdditions },
		coverageRules: deps.coverageRules,
		logError: deps.logError ?? (() => {}),
	});
}

function parseCoverage(params: { parser: ReturnType<typeof initParser>; html: string }): readonly CoverageInspection[] {
	const result = params.parser.parseHtml({
		url: "https://example.com/guide",
		documentUrl: "https://example.com/guide",
		html: params.html,
		thumbnailUrl: null,
	});
	assert(result.ok, "the page parses");
	return result.coverage;
}

function onlyInspected(coverage: readonly CoverageInspection[]): Extract<CoverageInspection, { kind: "inspected" }> {
	assert.equal(coverage.length, 1);
	const [inspection] = coverage;
	assert(inspection?.kind === "inspected", "the rule inspected the source");
	return inspection;
}

describe("initReadabilityParser coverage inspection", () => {
	it("inspects the source html once against the document url", () => {
		const inspect = jest.fn((_source: { html: string; documentUrl: string }) => []);
		const parser = initParser({ coverageRules: { inspect } });

		parser.parseHtml({
			url: "https://example.com/guide",
			documentUrl: "https://example.com/final",
			html: ARTICLE_HTML,
			thumbnailUrl: null,
		});

		expect(inspect.mock.calls).toEqual([[{ html: ARTICLE_HTML, documentUrl: "https://example.com/final" }]]);
	});

	it("returns an abstained inspection as the rule gave it", () => {
		const abstained: SourceInspection = { ...ASSESSED, kind: "abstained", reason: "no-section-structure" };
		const parser = initParser({ coverageRules: { inspect: () => [abstained] } });

		expect(parseCoverage({ parser, html: ARTICLE_HTML })).toEqual([abstained]);
	});

	it("skips inspection when a site rule replaces the page", () => {
		const inspect = jest.fn(() => [inspectedSource()]);
		const parser = initParser({
			coverageRules: { inspect },
			siteRules: [
				{
					matches: () => true,
					extract: () => ({ title: "Replaced", bodyHtml: "<p>A site rule supplied this body in place of the page.</p>" }),
				},
			],
		});

		expect(parseCoverage({ parser, html: ARTICLE_HTML })).toEqual([]);
		expect(inspect).not.toHaveBeenCalled();
	});

	it("logs an inspection that throws and returns no coverage", () => {
		const logError = jest.fn();
		const parser = initParser({
			coverageRules: {
				inspect: () => {
					throw new Error("inspect broke");
				},
			},
			logError,
		});

		expect(parseCoverage({ parser, html: ARTICLE_HTML })).toEqual([]);
		expect(logError).toHaveBeenCalledWith(
			"[ReadabilityParser] Coverage inspection threw for https://example.com/guide",
			new Error("inspect broke"),
		);
	});

	it("carries coverage when Readability finds no article", () => {
		const parser = initParser({
			coverageRules: { inspect: () => [inspectedSource()] },
			readabilityAdditions: { normalizeImplicitBody: () => {} },
		});

		const result = parser.parseHtml({
			url: "https://example.com/guide",
			documentUrl: "https://example.com/guide",
			html: "<html></html>",
			thumbnailUrl: null,
		});

		assert(result.ok, "the page parses");
		expect(result.article.content).toBe("");
		expect(result.coverage.map(({ kind }) => kind)).toEqual(["inspected"]);
	});

	it("passes verify through to the rule", () => {
		const verify = jest.fn(() => ({ outcome: "unknown" as const, reasons: ["missing-section" as const] }));
		const parser = initParser({ coverageRules: { inspect: () => [inspectedSource({ verify })] } });
		const inspection = onlyInspected(parseCoverage({ parser, html: ARTICLE_HTML }));
		const media = new Map([["https://example.com/a.png", "https://cdn.example/a.png"]]);

		expect(inspection.verify({ readerHtml: "<p>reader</p>", media })).toEqual({ outcome: "unknown", reasons: ["missing-section"] });
		expect(verify).toHaveBeenCalledWith({ readerHtml: "<p>reader</p>", media });
		expect({ ruleId: inspection.ruleId, ruleVersion: inspection.ruleVersion, mode: inspection.mode }).toEqual(ASSESSED);
	});

	it("reads a verify that throws as unknown with rule-failed", () => {
		const logError = jest.fn();
		const parser = initParser({
			coverageRules: {
				inspect: () => [
					inspectedSource({
						verify: () => {
							throw new Error("verify broke");
						},
					}),
				],
			},
			logError,
		});
		const inspection = onlyInspected(parseCoverage({ parser, html: ARTICLE_HTML }));

		expect(inspection.verify({ readerHtml: "<p>reader</p>", media: new Map() })).toEqual({
			outcome: "unknown",
			reasons: ["rule-failed"],
		});
		expect(logError).toHaveBeenCalledWith(
			"[ReadabilityParser] Coverage verify threw for https://example.com/guide",
			new Error("verify broke"),
		);
	});

	it("offers no alternative when the rule recovered no body", () => {
		const parser = initParser({ coverageRules: { inspect: () => [inspectedSource()] } });

		expect(onlyInspected(parseCoverage({ parser, html: ARTICLE_HTML })).alternative).toBeUndefined();
	});

	it("materialises the recovered body through the reader's transforms", () => {
		const parser = initParser({
			coverageRules: {
				inspect: () => [
					inspectedSource({ recoveredBodyHtml: '<h1>Part one</h1><p>Read <a href="/next">the next part</a> here.</p>' }),
				],
			},
			siteRules: [
				{
					matches: () => true,
					transform: ({ document }) => {
						document.querySelector("p")?.setAttribute("data-transformed", "yes");
					},
				},
			],
		});
		const { alternative } = onlyInspected(parseCoverage({ parser, html: ARTICLE_HTML }));

		assert(alternative, "the rule recovered a body");
		expect(alternative()).toEqual({
			content:
				'<h1>Part one</h1><p data-transformed="yes">Read <a href="https://example.com/next">the next part</a> here.</p>',
			wordCount: 6,
		});
	});

	it("reads an alternative that throws while materialising as no alternative", () => {
		const logError = jest.fn();
		const parser = initParser({
			coverageRules: { inspect: () => [inspectedSource({ recoveredBodyHtml: "<p>Recovered body.</p>" })] },
			readabilityAdditions: {
				restoreRetaggedTables: (html) => {
					assert(!html.includes("Recovered body"), new Error("restore broke"));
					return html;
				},
			},
			logError,
		});
		const { alternative } = onlyInspected(parseCoverage({ parser, html: ARTICLE_HTML }));

		assert(alternative, "the rule recovered a body");
		expect(alternative()).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(
			"[ReadabilityParser] Coverage alternative threw for https://example.com/guide",
			new Error("restore broke"),
		);
	});

	it("leaves the baseline body unchanged whether the rules are on or off", () => {
		const html = readFileSync(join(__dirname, "fixtures", "coverage-psn-control.html"), "utf8");
		const parse = (coverageRules: ActiveCoverageRules) =>
			initParser({ coverageRules }).parseHtml({
				url: "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide",
				documentUrl: "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide",
				html,
				thumbnailUrl: null,
			});
		const off = parse(activateCoverageRules({ rules: initArticleCoverageRules(), modes: ALL_COVERAGE_RULES_OFF }));
		const shadow = parse(activateCoverageRules({ rules: initArticleCoverageRules(), modes: { "section-coverage": "shadow" } }));

		assert(off.ok && shadow.ok, "the page parses");
		expect(shadow.article).toEqual(off.article);
		expect(off.coverage).toEqual([]);
	});

	it("plans a repair of the PSNProfiles control guide that a shadow rule would apply", () => {
		const html = readFileSync(join(__dirname, "fixtures", "coverage-psn-control.html"), "utf8");
		const parser = initParser({
			coverageRules: activateCoverageRules({ rules: initArticleCoverageRules(), modes: { "section-coverage": "shadow" } }),
		});
		const result = parser.parseHtml({
			url: "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide",
			documentUrl: "https://psnprofiles.com/guide/16422-silent-hill-f-trophy-guide",
			html,
			thumbnailUrl: null,
		});

		assert(result.ok, "the page parses");
		const plan = planCoverageRepair({ baselineContent: result.article.content, inspections: result.coverage });
		expect(plan.entries.map(({ baseline, wouldRepair }) => ({ outcome: baseline.outcome, wouldRepair }))).toEqual([
			{ outcome: "known-partial", wouldRepair: true },
		]);
		expect(plan.repair).toBeUndefined();
	});
});
