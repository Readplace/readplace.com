import assert from "node:assert/strict";
import { type ArticleCoverage, CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { RecrawlContentExtractedEvent, RefreshContentExtractedEvent, TierContentExtractedEvent } from "@packages/infra-components";
import type { TierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { candidateProvenance } from "@packages/tier-source";
import { initCommitTierCandidate } from "./commit-tier-candidate";

const URL = "https://example.com/article";
const SOURCE_URL = "https://example.com/article?edition=today";
const ATTEMPT_ID = SaveAttemptIdSchema.parse("attempt-1");
const FETCHED_AT = "2026-10-01T00:00:00.000Z";
const HTML = "<p>Reader content</p>";
const RAW = "<html><body><p>Reader content</p></body></html>";
const METADATA = { title: "T", siteName: "example.com", excerpt: "e", wordCount: 3, estimatedReadTime: 1, imageUrl: undefined };
const SNAPSHOT: TierSnapshot = { tier0Status: "not_attempted", tier1Status: "failed", pickedTier: "none" };

function harness() {
	const trace: unknown[][] = [];
	const commitTierCandidate = initCommitTierCandidate({
		putTierSource: async (params) => {
			trace.push(["putTierSource", params]);
			return params.metadata;
		},
		publishEvent: async (event, detail) => {
			trace.push(["publishEvent", event.detailType, detail]);
		},
	});
	const crawlOutcome = {
		report: "success" as const,
		readSnapshot: async () => {
			trace.push(["readSnapshot"]);
			return SNAPSHOT;
		},
		logCrawlOutcome: (params: unknown) => {
			trace.push(["logCrawlOutcome", params]);
		},
	};
	return { trace, commitTierCandidate, crawlOutcome };
}

const common = { url: URL, attemptId: ATTEMPT_ID, originalUrl: URL, sourceUrl: SOURCE_URL, fetchedAt: FETCHED_AT, metadata: METADATA, html: HTML };

describe("initCommitTierCandidate", () => {
	it("stores a reader capture with its evaluation bytes, reports its success against tier-1, and announces it to content selection", async () => {
		const { trace, commitTierCandidate, crawlOutcome } = harness();

		const reference = await commitTierCandidate({
			...common,
			leg: { tier: "tier-0", kind: "extension", captureTrigger: "manual" },
			evaluation: { hashed: RAW, stored: RAW },
			afterStore: () => {
				trace.push(["afterStore"]);
			},
			crawlOutcome,
			announce: { event: "tier-content-extracted", userId: UserIdSchema.parse("user-1"), extractedAt: () => "2026-10-01T00:00:05.000Z" },
		});

		const metadata = candidateProvenance({ metadata: METADATA, html: HTML, evaluationHtml: RAW, attemptId: ATTEMPT_ID, originalUrl: URL, sourceUrl: SOURCE_URL, kind: "extension", fetchedAt: FETCHED_AT, captureTrigger: "manual" });
		assert.deepEqual(reference, { id: metadata.id, tier: "tier-0" });
		assert.deepEqual(trace, [
			["putTierSource", { url: URL, tier: "tier-0", html: HTML, evaluationHtml: RAW, metadata }],
			["afterStore"],
			["readSnapshot"],
			["logCrawlOutcome", { url: URL, thisTier: "tier-0", thisTierStatus: "success", otherTierStatus: "failed", pickedTier: "none" }],
			["publishEvent", TierContentExtractedEvent.detailType, { saveAttemptId: ATTEMPT_ID, candidates: [{ id: metadata.id, tier: "tier-0" }], url: URL, userId: "user-1", extractedAt: "2026-10-01T00:00:05.000Z" }],
		]);
	});

	it("hashes evaluation bytes it does not store, reports a live candidate against tier-0, and announces a refresh", async () => {
		const { trace, commitTierCandidate, crawlOutcome } = harness();

		const reference = await commitTierCandidate({
			...common,
			leg: { tier: "tier-1", kind: "live" },
			evaluation: { hashed: RAW, stored: undefined },
			crawlOutcome,
			announce: { event: "refresh-content-extracted", etag: '"e"', lastModified: undefined, contentFetchedAt: FETCHED_AT, bodyHash: "a".repeat(64) },
		});

		const metadata = candidateProvenance({ metadata: METADATA, html: HTML, evaluationHtml: RAW, attemptId: ATTEMPT_ID, originalUrl: URL, sourceUrl: SOURCE_URL, kind: "live", fetchedAt: FETCHED_AT });
		assert.deepEqual(reference, { id: metadata.id, tier: "tier-1" });
		assert.deepEqual(trace, [
			["putTierSource", { url: URL, tier: "tier-1", html: HTML, metadata }],
			["readSnapshot"],
			["logCrawlOutcome", { url: URL, thisTier: "tier-1", thisTierStatus: "success", otherTierStatus: "not_attempted", pickedTier: "none" }],
			["publishEvent", RefreshContentExtractedEvent.detailType, { saveAttemptId: ATTEMPT_ID, candidates: [{ id: metadata.id, tier: "tier-1" }], url: URL, etag: '"e"', lastModified: undefined, contentFetchedAt: FETCHED_AT, bodyHash: "a".repeat(64) }],
		]);
	});

	it("stores a wrapper candidate with its response status and neither reports nor announces it when asked not to", async () => {
		const { trace, commitTierCandidate } = harness();

		const reference = await commitTierCandidate({
			...common,
			leg: { tier: "tier-2", kind: "wrapper", httpStatus: 203 },
			evaluation: { hashed: RAW, stored: RAW },
			crawlOutcome: { report: "none" },
			announce: { event: "none" },
		});

		const metadata = candidateProvenance({ metadata: METADATA, html: HTML, evaluationHtml: RAW, attemptId: ATTEMPT_ID, originalUrl: URL, sourceUrl: SOURCE_URL, kind: "wrapper", fetchedAt: FETCHED_AT, httpStatus: 203 });
		assert.deepEqual(reference, { id: metadata.id, tier: "tier-2" });
		assert.equal(metadata.httpStatus, 203);
		assert.deepEqual(trace, [["putTierSource", { url: URL, tier: "tier-2", html: HTML, evaluationHtml: RAW, metadata }]]);
	});

	it("stores a rendered live candidate beside earlier ones, awaits its after-store work, reports a failure, and announces a recrawl it builds once stored", async () => {
		const { trace, commitTierCandidate, crawlOutcome } = harness();
		const archived = { id: CandidateIdSchema.parse("archive-candidate"), tier: "tier-2" as const };
		let extractedAt = "";

		const reference = await commitTierCandidate({
			...common,
			leg: { tier: "tier-1", kind: "live", httpStatus: 404, renderedThrough: "residential-proxy" },
			evaluation: { hashed: RAW, stored: RAW },
			afterStore: async () => {
				await Promise.resolve();
				extractedAt = "2026-10-01T00:00:09.000Z";
				trace.push(["afterStore"]);
			},
			crawlOutcome: { ...crawlOutcome, report: "failed" },
			priorCandidates: [archived],
			announce: () => ({ event: "recrawl-content-extracted", extractedAt: () => extractedAt }),
		});

		const metadata = candidateProvenance({ metadata: METADATA, html: HTML, evaluationHtml: RAW, attemptId: ATTEMPT_ID, originalUrl: URL, sourceUrl: SOURCE_URL, kind: "live", fetchedAt: FETCHED_AT, httpStatus: 404, renderedThrough: "residential-proxy" });
		assert.deepEqual(reference, { id: metadata.id, tier: "tier-1" });
		assert.equal(metadata.renderedThrough, "residential-proxy");
		assert.deepEqual(trace, [
			["putTierSource", { url: URL, tier: "tier-1", html: HTML, evaluationHtml: RAW, metadata }],
			["afterStore"],
			["readSnapshot"],
			["logCrawlOutcome", { url: URL, thisTier: "tier-1", thisTierStatus: "failed", otherTierStatus: "not_attempted", pickedTier: "none" }],
			["publishEvent", RecrawlContentExtractedEvent.detailType, { saveAttemptId: ATTEMPT_ID, candidates: [archived, { id: metadata.id, tier: "tier-1" }], url: URL, extractedAt: "2026-10-01T00:00:09.000Z" }],
		]);
	});

	it("keeps two concurrent attempts on the same page as two candidates, each manifest carrying its own attempt's coverage", async () => {
		const { trace, commitTierCandidate } = harness();
		const secondAttemptId = SaveAttemptIdSchema.parse("attempt-2");
		const firstCoverage: ArticleCoverage = {
			schemaVersion: 1,
			sourceDigest: "a".repeat(64),
			outputDigest: "b".repeat(64),
			assessments: [{ ruleId: "section-coverage", ruleVersion: 1, mode: "shadow", repair: "would-apply", outcome: "known-partial", scope: { kind: "article", units: 14 }, covered: 1, unresolved: 13, reasons: ["missing-section"] }],
		};
		const secondCoverage: ArticleCoverage = {
			schemaVersion: 1,
			sourceDigest: "c".repeat(64),
			outputDigest: "d".repeat(64),
			assessments: [{ ruleId: "section-coverage", ruleVersion: 1, mode: "shadow", repair: "none", outcome: "verified-for-scope", scope: { kind: "article", units: 14 }, covered: 14 }],
		};
		const commitAttempt = (params: { attemptId: typeof ATTEMPT_ID; coverage: ArticleCoverage }) => commitTierCandidate({
			...common,
			attemptId: params.attemptId,
			metadata: { ...METADATA, coverage: params.coverage },
			leg: { tier: "tier-1", kind: "live" },
			evaluation: { hashed: RAW, stored: RAW },
			crawlOutcome: { report: "none" },
			announce: { event: "none" },
		});

		const [first, second] = await Promise.all([
			commitAttempt({ attemptId: ATTEMPT_ID, coverage: firstCoverage }),
			commitAttempt({ attemptId: secondAttemptId, coverage: secondCoverage }),
		]);

		const firstMetadata = candidateProvenance({ metadata: { ...METADATA, coverage: firstCoverage }, html: HTML, evaluationHtml: RAW, attemptId: ATTEMPT_ID, originalUrl: URL, sourceUrl: SOURCE_URL, kind: "live", fetchedAt: FETCHED_AT });
		const secondMetadata = candidateProvenance({ metadata: { ...METADATA, coverage: secondCoverage }, html: HTML, evaluationHtml: RAW, attemptId: secondAttemptId, originalUrl: URL, sourceUrl: SOURCE_URL, kind: "live", fetchedAt: FETCHED_AT });
		assert.notEqual(first.id, second.id);
		assert.deepEqual([first, second], [{ id: firstMetadata.id, tier: "tier-1" }, { id: secondMetadata.id, tier: "tier-1" }]);
		assert.deepEqual([firstMetadata.coverage, secondMetadata.coverage], [firstCoverage, secondCoverage]);
		assert.deepEqual(trace, [
			["putTierSource", { url: URL, tier: "tier-1", html: HTML, evaluationHtml: RAW, metadata: firstMetadata }],
			["putTierSource", { url: URL, tier: "tier-1", html: HTML, evaluationHtml: RAW, metadata: secondMetadata }],
		]);
	});
});
