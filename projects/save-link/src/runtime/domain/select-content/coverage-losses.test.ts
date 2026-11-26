import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ALL_COVERAGE_RULES_OFF, SaveAttemptIdSchema, type ArticleCoverage, type CoverageAssessment, type CoverageRuleModes, type CoverageScope } from "@packages/domain/article";
import { candidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import { NO_SELECTION_COVERAGE, coverageLossesOf, coverageNoteOf, readBoundCoverage } from "./coverage-losses";

const URL = "https://example.com/guide";
const ENFORCE: CoverageRuleModes = { "section-coverage": "enforce" };
const SHADOW: CoverageRuleModes = { "section-coverage": "shadow" };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function verified(params: { units: number; kind?: CoverageScope["kind"]; ruleVersion?: number }): CoverageAssessment {
	return { ruleId: "section-coverage", ruleVersion: params.ruleVersion ?? 1, mode: "enforce", repair: "none", outcome: "verified-for-scope", scope: { kind: params.kind ?? "article", units: params.units }, covered: params.units };
}

function partial(params: { units: number; covered: number; kind?: CoverageScope["kind"] }): CoverageAssessment {
	return { ruleId: "section-coverage", ruleVersion: 1, mode: "enforce", repair: "none", outcome: "known-partial", scope: { kind: params.kind ?? "article", units: params.units }, covered: params.covered, unresolved: params.units - params.covered, reasons: ["missing-section"] };
}

const unknown: CoverageAssessment = { ruleId: "section-coverage", ruleVersion: 1, mode: "shadow", repair: "none", outcome: "unknown", reasons: ["no-section-structure"] };

function candidate(params: { name: string; html?: string; evaluationHtml?: string; coverage?: unknown; kind?: "live" | "extension"; captureTrigger?: "automatic" }): VerifiedTierSource {
	const html = params.html ?? `<p>${params.name} body</p>`;
	const evaluationHtml = params.evaluationHtml ?? html;
	const metadata = candidateProvenance({
		metadata: { title: "Guide", siteName: "example.com", excerpt: "", wordCount: 100, estimatedReadTime: 1, coverage: params.coverage },
		html, evaluationHtml, attemptId: SaveAttemptIdSchema.parse("attempt"), originalUrl: URL, sourceUrl: URL,
		kind: params.kind ?? "live", fetchedAt: "2026-11-26T00:00:00.000Z", captureTrigger: params.captureTrigger,
	});
	return { tier: params.kind === "extension" ? "tier-0" : "tier-1", html, evaluationHtml, metadata };
}

function boundTo(params: { html: string; evaluationHtml?: string; assessments: CoverageAssessment[] }): ArticleCoverage {
	return { schemaVersion: 1, sourceDigest: sha256(params.evaluationHtml ?? params.html), outputDigest: sha256(params.html), assessments: params.assessments };
}

function withAssessments(name: string, assessments: CoverageAssessment[]): VerifiedTierSource {
	const html = `<p>${name} body</p>`;
	return candidate({ name, html, coverage: boundTo({ html, assessments }) });
}

const lossesOf = (sources: VerifiedTierSource[], modes: CoverageRuleModes = ENFORCE) => coverageLossesOf({
	sources, modes, isReadable: (source) => !source.html.includes("unreadable"), isWitness: (source) => source.metadata.httpStatus === undefined || source.metadata.httpStatus < 400, isTapCapture: (source) => source.metadata.kind === "extension" && source.metadata.captureTrigger !== "automatic",
});

describe("readBoundCoverage", () => {
	it.each([
		["absent", undefined],
		["malformed", { schemaVersion: 1, assessments: "none" }],
		["written by a newer schema", { schemaVersion: 2, sourceDigest: sha256("<p>x</p>"), outputDigest: sha256("<p>x</p>"), assessments: [verified({ units: 3 })] }],
	])("reads a legacy manifest whose coverage is %s as unknown", (_label, coverage) => {
		assert.equal(readBoundCoverage(candidate({ name: "legacy", coverage })), undefined);
	});

	it("returns the evidence when it describes the stored bytes", () => {
		const coverage = boundTo({ html: "<p>stored</p>", assessments: [verified({ units: 3 })] });
		assert.deepEqual(readBoundCoverage(candidate({ name: "stored", html: "<p>stored</p>", coverage })), coverage);
	});

	it("reads unknown when the output digest does not match the stored reader html", () => {
		const coverage = boundTo({ html: "<p>an earlier retry</p>", assessments: [verified({ units: 3 })] });
		assert.equal(readBoundCoverage(candidate({ name: "stored", html: "<p>stored</p>", coverage })), undefined);
	});

	it("binds the source digest to the separate source body the manifest holds", () => {
		const html = "<p>reader</p>";
		const evaluationHtml = "<html><body><p>source</p></body></html>";
		const bound = boundTo({ html, evaluationHtml, assessments: [verified({ units: 3 })] });
		assert.deepEqual(readBoundCoverage(candidate({ name: "split", html, evaluationHtml, coverage: bound })), bound);
		const otherSource = { ...bound, sourceDigest: sha256("<html>another source</html>") };
		assert.equal(readBoundCoverage(candidate({ name: "split", html, evaluationHtml, coverage: otherSource })), undefined);
	});

	it("ignores the source digest when the manifest holds no separate source body", () => {
		const html = "<p>reader</p>";
		const coverage = { ...boundTo({ html, assessments: [verified({ units: 3 })] }), sourceDigest: sha256("<html>the page finalize was given</html>") };
		assert.deepEqual(readBoundCoverage(candidate({ name: "same", html, coverage })), coverage);
	});
});

describe("coverageLossesOf", () => {
	it("excludes a confirmed loss beside a candidate verified with at least as many units under enforce", () => {
		const lossy = withAssessments("lossy", [partial({ units: 14, covered: 1 })]);
		const repaired = withAssessments("repaired", [verified({ units: 14 })]);
		const result = lossesOf([lossy, repaired]);
		assert.deepEqual(result.excludedIds, [lossy.metadata.id]);
		assert.deepEqual(result.wouldExcludeIds, []);
		assert.equal(result.byCandidate.size, 2);
	});

	it("only records what it would exclude under shadow", () => {
		const lossy = withAssessments("lossy", [partial({ units: 14, covered: 1 })]);
		const result = lossesOf([lossy, withAssessments("repaired", [verified({ units: 14 })])], SHADOW);
		assert.deepEqual(result.excludedIds, []);
		assert.deepEqual(result.wouldExcludeIds, [lossy.metadata.id]);
	});

	it("reads nothing as lost when the rule is off", () => {
		const result = lossesOf([withAssessments("lossy", [partial({ units: 14, covered: 1 })]), withAssessments("repaired", [verified({ units: 14 })])], ALL_COVERAGE_RULES_OFF);
		assert.deepEqual(result.excludedIds, []);
		assert.deepEqual(result.wouldExcludeIds, []);
	});

	it("keeps a shorter publisher revision that verifies against its own source eligible", () => {
		const result = lossesOf([withAssessments("revision", [verified({ units: 13 })]), withAssessments("full", [verified({ units: 14 })])]);
		assert.deepEqual(result.excludedIds, []);
	});

	it("keeps a loss eligible when no readable candidate is verified with as many units", () => {
		const unreadableVerified = candidate({ name: "unreadable", html: "<p>unreadable</p>", coverage: boundTo({ html: "<p>unreadable</p>", assessments: [verified({ units: 14 })] }) });
		assert.deepEqual(lossesOf([withAssessments("lossy", [partial({ units: 14, covered: 1 })]), withAssessments("smaller", [verified({ units: 13 })])]).excludedIds, []);
		assert.deepEqual(lossesOf([withAssessments("lossy", [partial({ units: 14, covered: 1 })]), unreadableVerified]).excludedIds, []);
		assert.deepEqual(lossesOf([withAssessments("lossy", [partial({ units: 14, covered: 1 })]), withAssessments("unknown", [unknown])]).excludedIds, []);
	});

	it("excludes nothing beside a verified candidate that answered an error status", () => {
		const html = "<p>blocked body</p>";
		const blocked = candidate({ name: "blocked", html, coverage: boundTo({ html, assessments: [verified({ units: 14 })] }) });
		blocked.metadata.httpStatus = 403;
		assert.deepEqual(lossesOf([withAssessments("lossy", [partial({ units: 14, covered: 1 })]), blocked]).excludedIds, []);
	});

	it("never lets a verified chapter certify the whole article, and never excludes a chapter-scoped loss", () => {
		assert.deepEqual(lossesOf([withAssessments("lossy", [partial({ units: 4, covered: 1 })]), withAssessments("chapter", [verified({ units: 16, kind: "chapter" })])]).excludedIds, []);
		assert.deepEqual(lossesOf([withAssessments("chapter-loss", [partial({ units: 4, covered: 1, kind: "chapter" })]), withAssessments("full", [verified({ units: 16 })])]).excludedIds, []);
	});

	it("ignores an assessment written by another rule version", () => {
		const lossy = withAssessments("lossy", [partial({ units: 14, covered: 1 })]);
		assert.deepEqual(lossesOf([lossy, withAssessments("retired", [verified({ units: 14, ruleVersion: 2 })])]).excludedIds, []);
	});

	it("never excludes a tapped capture, and excludes an automatic capture like a crawl copy", () => {
		const html = "<p>capture body</p>";
		const coverage = boundTo({ html, assessments: [partial({ units: 14, covered: 1 })] });
		const tapped = candidate({ name: "tapped", html, coverage, kind: "extension" });
		const automatic = candidate({ name: "automatic", html, coverage, kind: "extension", captureTrigger: "automatic" });
		const repaired = withAssessments("repaired", [verified({ units: 14 })]);
		assert.deepEqual(lossesOf([tapped, repaired]).excludedIds, []);
		assert.deepEqual(lossesOf([automatic, repaired]).excludedIds, [automatic.metadata.id]);
	});

	it("keeps a candidate whose coverage cannot be read among the sources it was given", () => {
		const legacy = candidate({ name: "legacy", coverage: { schemaVersion: 2 } });
		const result = lossesOf([legacy, withAssessments("repaired", [verified({ units: 14 })])]);
		assert.equal(result.byCandidate.has(legacy.metadata.id), false);
		assert.deepEqual(result.excludedIds, []);
	});

	it("starts from an empty selection coverage", () => {
		assert.deepEqual(NO_SELECTION_COVERAGE, { byCandidate: new Map(), excludedIds: [], wouldExcludeIds: [] });
	});
});

describe("coverageNoteOf", () => {
	const coverage = boundTo({ html: "<p>x</p>", assessments: [partial({ units: 14, covered: 1 })] });

	it("names the rule, its version, the outcome and the counts under enforce", () => {
		assert.equal(coverageNoteOf({ coverage, modes: ENFORCE }), "section-coverage@1 known-partial 1/14");
		assert.equal(coverageNoteOf({ coverage: boundTo({ html: "<p>x</p>", assessments: [verified({ units: 14 }), partial({ units: 14, covered: 2 })] }), modes: ENFORCE }), "section-coverage@1 verified-for-scope 14/14; section-coverage@1 known-partial 2/14");
	});

	it("gives no note outside enforce, for unknown or retired evidence, or without evidence", () => {
		assert.equal(coverageNoteOf({ coverage, modes: SHADOW }), undefined);
		assert.equal(coverageNoteOf({ coverage: boundTo({ html: "<p>x</p>", assessments: [unknown] }), modes: ENFORCE }), undefined);
		assert.equal(coverageNoteOf({ coverage: boundTo({ html: "<p>x</p>", assessments: [verified({ units: 3, ruleVersion: 2 })] }), modes: ENFORCE }), undefined);
		assert.equal(coverageNoteOf({ coverage: undefined, modes: ENFORCE }), undefined);
	});
});
