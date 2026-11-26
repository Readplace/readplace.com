import assert from "node:assert/strict";
import {
	ALL_COVERAGE_RULES_OFF,
	ArticleCoverageSchema,
	COVERAGE_RULE_VERSIONS,
	certifiesArticle,
	isConfirmedArticleLoss,
	isWorseOutcome,
	parseCoverageRuleModes,
	type ArticleCoverage,
	type CoverageOutcome,
} from "./article-coverage";

const DIGEST = "a".repeat(64);
const assessed = { ruleId: "section-coverage", ruleVersion: COVERAGE_RULE_VERSIONS["section-coverage"], mode: "shadow" } as const;

const unknown: CoverageOutcome = { outcome: "unknown", reasons: ["no-section-structure"] };
const verifiedArticle: CoverageOutcome = { outcome: "verified-for-scope", scope: { kind: "article", units: 14 }, covered: 14 };
const verifiedChapter: CoverageOutcome = { outcome: "verified-for-scope", scope: { kind: "chapter", units: 3 }, covered: 3 };
const partialArticle = (covered: number): CoverageOutcome => ({ outcome: "known-partial", scope: { kind: "article", units: 16 }, covered, unresolved: 16 - covered, reasons: ["missing-section"] });
const partialChapter: CoverageOutcome = { outcome: "known-partial", scope: { kind: "chapter", units: 4 }, covered: 1, unresolved: 3, reasons: ["missing-section"] };

describe("parseCoverageRuleModes", () => {
	it("reads every registered rule's mode from the configured JSON", () => {
		for (const mode of ["off", "shadow", "enforce"]) {
			assert.deepEqual(parseCoverageRuleModes(JSON.stringify({ "section-coverage": mode })), { "section-coverage": mode });
		}
	});

	it("rejects a missing rule, an unknown rule and an unknown mode, so a cold start never runs on a guessed mode", () => {
		for (const raw of [{}, { "section-coverage": "off", "other-rule": "off" }, { "section-coverage": "on" }]) {
			assert.throws(() => parseCoverageRuleModes(JSON.stringify(raw)));
		}
	});

	it("names every registered rule as off in the explicit all-off modes", () => {
		assert.deepEqual(ALL_COVERAGE_RULES_OFF, parseCoverageRuleModes('{"section-coverage":"off"}'));
	});
});

describe("ArticleCoverageSchema", () => {
	it("round-trips every outcome a manifest can hold", () => {
		const coverage: ArticleCoverage = {
			schemaVersion: 1,
			sourceDigest: DIGEST,
			outputDigest: "0123456789abcdef".repeat(4),
			assessments: [
				{ ...assessed, repair: "none", outcome: "unknown", reasons: ["rule-failed"] },
				{ ...assessed, repair: "applied", outcome: "verified-for-scope", scope: { kind: "article", units: 16 }, covered: 16 },
				{ ...assessed, mode: "enforce", repair: "regressed", outcome: "known-partial", scope: { kind: "article", units: 16 }, covered: 0, unresolved: 16, reasons: ["missing-section", "recovery-not-verified"] },
			],
		};
		assert.deepEqual(ArticleCoverageSchema.parse(JSON.parse(JSON.stringify(coverage))), coverage);
	});

	it("refuses evidence a newer rule set or a corrupted write produced", () => {
		const valid = { schemaVersion: 1, sourceDigest: DIGEST, outputDigest: DIGEST, assessments: [{ ...assessed, repair: "none", outcome: "unknown", reasons: ["rule-failed"] }] };
		const [assessment] = valid.assessments;
		for (const broken of [
			{ ...valid, schemaVersion: 2 },
			{ ...valid, sourceDigest: "A".repeat(64) },
			{ ...valid, outputDigest: "a".repeat(63) },
			{ ...valid, assessments: [] },
			{ ...valid, assessments: Array.from({ length: 9 }, () => assessment) },
			{ ...valid, assessments: [{ ...assessment, ruleId: "future-rule" }] },
			{ ...valid, assessments: [{ ...assessment, mode: "off" }] },
			{ ...valid, assessments: [{ ...assessment, reasons: ["future-reason"] }] },
			{ ...valid, assessments: [{ ...assessment, reasons: [] }] },
			{ ...valid, assessments: [{ ...assessment, outcome: "verified-for-scope", scope: { kind: "article", units: 1 }, covered: 0 }] },
			{ ...valid, assessments: [{ ...assessment, outcome: "known-partial", scope: { kind: "article", units: 1 }, covered: 1, unresolved: 0 }] },
		]) {
			assert.equal(ArticleCoverageSchema.safeParse(broken).success, false, JSON.stringify(broken));
		}
	});
});

describe("certifiesArticle", () => {
	it("certifies only a verification whose scope is the whole article, so a verified chapter cannot certify a whole guide", () => {
		assert.deepEqual([verifiedArticle, verifiedChapter, partialArticle(3), unknown].map(certifiesArticle), [true, false, false, false]);
	});
});

describe("isConfirmedArticleLoss", () => {
	it("confirms a loss only when a known-partial outcome covers the whole article", () => {
		assert.deepEqual([partialArticle(3), partialChapter, verifiedArticle, unknown].map(isConfirmedArticleLoss), [true, false, false, false]);
	});
});

describe("isWorseOutcome", () => {
	it.each<[string, CoverageOutcome, CoverageOutcome, boolean]>([
		["unknown before is never worsened", unknown, partialArticle(0), false],
		["unknown before stays unknown", unknown, unknown, false],
		["verified before and after", verifiedArticle, verifiedChapter, false],
		["verified before, unknown after", verifiedArticle, unknown, true],
		["verified before, partial after", verifiedArticle, partialArticle(15), true],
		["partial before, fewer covered after", partialArticle(5), partialArticle(4), true],
		["partial before, as many covered after", partialArticle(5), partialArticle(5), false],
		["partial before, more covered after", partialArticle(5), partialArticle(6), false],
		["partial before, unknown after", partialArticle(5), unknown, false],
		["partial before, verified after", partialArticle(5), verifiedArticle, false],
	])("%s", (_name, previous, next, worse) => {
		assert.equal(isWorseOutcome({ next, previous }), worse);
	});
});
