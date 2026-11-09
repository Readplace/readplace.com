import { CandidateIdSchema, SaveAttemptIdSchema, type SaveAttemptId } from "@packages/domain/article";
import type { Article } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/logger";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { initJudgeUnderLedger } from "./judge-under-ledger";
import { candidateProvenance, type Tier, type VerifiedTierSource } from "@packages/tier-source";
import { type SelectionMode, initLogContentSelection, initPrepareContentSelection } from "./prepare-content-selection";
import type { SelectMostCompleteContent } from "./select-content";
import type { CandidateReference } from "./list-available-tier-sources";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/article";
const ARCHIVE = "https://archive.ph/abc12";
const NOW = "2026-10-22T00:00:00.000Z";
const EARLIER = "2026-10-20T00:00:00.000Z";
const LATER = "2026-10-21T00:00:00.000Z";
const MESSAGE_ATTEMPT = SaveAttemptIdSchema.parse("message-attempt");
const LATER_ATTEMPT = SaveAttemptIdSchema.parse("later-attempt");
const METADATA = { title: "Article", siteName: "example.com", excerpt: "", wordCount: 120, estimatedReadTime: 1 };

function candidate(params: { id: string; attemptId: SaveAttemptId; fetchedAt: string; html?: string; tier?: Tier; sourceUrl?: string; directResourceKind?: "plain-text" }): VerifiedTierSource {
	const html = params.html ?? `<article><p>The body ${params.id} fetched at ${params.fetchedAt}.</p></article>`;
	const tier = params.tier ?? "tier-1";
	return {
		tier, html,
		metadata: { ...candidateProvenance({
			metadata: { ...METADATA, directResourceKind: params.directResourceKind },
			html, evaluationHtml: html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: params.sourceUrl ?? URL,
			kind: tier === "tier-2" ? "wrapper" : "live", fetchedAt: params.fetchedAt, httpStatus: 200,
		}), id: CandidateIdSchema.parse(params.id) },
	};
}

function article(canonical: VerifiedTierSource, overrides: Partial<Article> = {}): Article {
	return {
		url: URL, metadata: METADATA, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(canonical.html) }, estimatedReadTime: 1,
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Existing summary" }, summaryAutoHeal: { attempts: 0 },
		contentSelection: { revision: 1, candidateId: canonical.metadata.id, tier: canonical.tier },
		...overrides,
	};
}

function setup(params: { sources: VerifiedTierSource[]; article: Article; pick: string }) {
	const judge = jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>()
		.mockImplementation(async ({ candidates }) => {
			const picked = candidates.find((sent) => sent.id === params.pick);
			return {
				...(picked === undefined ? { kind: "none", reason: "No pick" } as const : { kind: "winner", candidateId: picked.id, reason: "The older copy reads better" } as const),
				readability: candidates.map((sent) => ({ candidateId: sent.id, readable: sent.id === params.pick })),
				audit: { judgedCandidates: [], promptHash: "prompt", responseStatus: "completed" },
			};
		});
	const prepare = initPrepareContentSelection({
		loadArticle: async () => params.article, readCanonicalContent: async () => undefined,
		listAvailableTierSources: async () => params.sources,
		judge: initJudgeUnderLedger({ selectMostCompleteContent: judge, runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => new Date(NOW) }), logger: noopLogger, now: () => new Date(NOW) }), claimTtlMs: 60_000, heldClaim: "assert" }),
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => ({ originalUrl: URL, sourceUrl: ARCHIVE }),
	});
	return {
		prepare: (candidates: readonly CandidateReference[], mode: SelectionMode = "recrawl") => prepare({ url: URL, saveAttemptId: MESSAGE_ATTEMPT, claimId: "message-1", mode, candidates }),
		judge,
	};
}

const refOf = (source: VerifiedTierSource): CandidateReference => ({ id: source.metadata.id, tier: source.tier });

describe("a recrawl message whose candidates were fetched before the committed canonical", () => {
	const canonical = candidate({ id: "canonical", attemptId: LATER_ATTEMPT, fetchedAt: LATER });
	const stale = candidate({ id: "stale", attemptId: MESSAGE_ATTEMPT, fetchedAt: EARLIER });

	it("retains the canonical without asking the judge, even when the judge would pick the older candidate", async () => {
		const { prepare, judge } = setup({ sources: [stale, canonical], article: article(canonical), pick: "stale" });
		const info = jest.fn();

		const result = await prepare([refOf(stale)]);
		initLogContentSelection({ logger: { ...noopLogger, info } })({ saveAttemptId: MESSAGE_ATTEMPT, selection: result });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical", reason: "every considered candidate was fetched before the committed canonical", judgedBodies: 0, ownCaptureFailed: false });
		expect(result.selected).toEqual(canonical);
		expect(result.readableIds).toEqual(new Set([canonical.metadata.id]));
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"selectedCandidateId":"canonical","outcome":"retained","selectionRule":"superseded-by-canonical"'));
	});

	it("retains the canonical over a stale direct resource of the message's attempt", async () => {
		const resource = candidate({ id: "resource", attemptId: MESSAGE_ATTEMPT, fetchedAt: EARLIER, html: "<pre>One short line.</pre>", directResourceKind: "plain-text" });
		const { prepare, judge } = setup({ sources: [resource, canonical], article: article(canonical), pick: "resource" });

		const result = await prepare([refOf(resource)]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical" });
		expect(result.selected?.metadata.id).toBe("canonical");
	});

	it("retains the canonical by the fence rule, not by unchanged prose, when the stale copy holds identical prose", async () => {
		const sameProse = candidate({ id: "same-prose", attemptId: MESSAGE_ATTEMPT, fetchedAt: EARLIER, html: canonical.html });
		const { prepare, judge } = setup({ sources: [sameProse, canonical], article: article(canonical), pick: "same-prose" });

		const result = await prepare([refOf(sameProse)]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical" });
		expect(result.selected?.metadata.id).toBe("canonical");
	});

	it("retains the canonical without the judge when both message candidates are older", async () => {
		const archived = candidate({ id: "archived", attemptId: MESSAGE_ATTEMPT, fetchedAt: EARLIER, tier: "tier-2", sourceUrl: ARCHIVE });
		const { prepare, judge } = setup({ sources: [stale, archived, canonical], article: article(canonical), pick: "stale" });

		const result = await prepare([refOf(stale), refOf(archived)]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical" });
		expect(result.selected?.metadata.id).toBe("canonical");
	});

	it("asks the judge once when one of two message candidates is newer than the canonical", async () => {
		const newer = candidate({ id: "newer", attemptId: MESSAGE_ATTEMPT, fetchedAt: NOW });
		const { prepare, judge } = setup({ sources: [stale, newer, canonical], article: article(canonical), pick: "newer" });

		const result = await prepare([refOf(stale), refOf(newer)]);

		expect(judge).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "judge" });
		expect(result.selected?.metadata.id).toBe("newer");
	});

	it("asks the judge once when none of the message's candidate manifests loaded", async () => {
		const { prepare, judge } = setup({ sources: [stale, canonical], article: article(canonical), pick: "stale" });

		const result = await prepare([{ id: CandidateIdSchema.parse("missing"), tier: "tier-1" }]);

		expect(judge).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "judge" });
		expect(result.selected?.metadata.id).toBe("stale");
	});

	it.each([
		{ name: "a tier-2 canonical", archive: candidate({ id: "archive", attemptId: LATER_ATTEMPT, fetchedAt: LATER, tier: "tier-2", sourceUrl: ARCHIVE }) },
		{ name: "a wrapper-host tier-1 canonical", archive: candidate({ id: "archive", attemptId: LATER_ATTEMPT, fetchedAt: LATER, sourceUrl: ARCHIVE }) },
	])("asks the judge once over $name fetched later than the message's live candidate", async ({ archive }) => {
		const { prepare, judge } = setup({ sources: [stale, archive], article: article(archive), pick: "stale" });

		const result = await prepare([refOf(stale)]);

		expect(judge).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "judge" });
		expect(result.selected?.metadata.id).toBe("stale");
	});

	it("asks the judge once in save mode for an older candidate that is not a direct resource", async () => {
		const { prepare, judge } = setup({ sources: [stale, canonical], article: article(canonical), pick: "stale" });

		const result = await prepare([refOf(stale)], "save");

		expect(judge).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "judge" });
		expect(result.selected?.metadata.id).toBe("stale");
	});

	it("asks the judge once for a current candidate over an older canonical", async () => {
		const olderCanonical = candidate({ id: "older-canonical", attemptId: LATER_ATTEMPT, fetchedAt: EARLIER });
		const current = candidate({ id: "current", attemptId: MESSAGE_ATTEMPT, fetchedAt: LATER });
		const { prepare, judge } = setup({ sources: [current, olderCanonical], article: article(olderCanonical), pick: "current" });

		const result = await prepare([refOf(current)]);

		expect(judge).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "judge" });
		expect(result.selected?.metadata.id).toBe("current");
	});

	it("still selects the canonical and stays retained when the canonical's summary needs a retry", async () => {
		const { prepare, judge } = setup({ sources: [stale, canonical], article: article(canonical, { summary: { kind: "skipped", reason: "content-too-short" } }), pick: "stale" });

		const result = await prepare([refOf(stale)]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical" });
		expect(result.selected?.metadata.id).toBe("canonical");
	});
});
