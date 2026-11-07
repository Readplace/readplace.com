import { CandidateIdSchema, SaveAttemptIdSchema, type SaveAttemptId } from "@packages/domain/article";
import type { Article } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/logger";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { initJudgeUnderLedger } from "./judge-under-ledger";
import { candidateProvenance, type TierSource, type VerifiedTierSource } from "@packages/tier-source";
import { type SelectionMode, initPrepareContentSelection } from "./prepare-content-selection";
import type { SelectMostCompleteContent } from "./select-content";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/resource";
const ARCHIVE = "https://archive.ph/abc12";
const NOW = "2026-10-22T00:00:00.000Z";
const T1 = "2026-10-20T00:00:00.000Z";
const T2 = "2026-10-21T00:00:00.000Z";
const A1 = SaveAttemptIdSchema.parse("attempt-1");
const A2 = SaveAttemptIdSchema.parse("attempt-2");
const METADATA = { title: "Resource", siteName: "example.com", excerpt: "", wordCount: 0, estimatedReadTime: 1 };

function resource(params: { kind: "image" | "plain-text"; id: string; attemptId: SaveAttemptId; fetchedAt: string }): VerifiedTierSource {
	const html = params.kind === "image" ? '<img src="https://cdn.example/resource.png">' : `<pre>One short line from ${params.id}.</pre>`;
	return {
		tier: "tier-1", html,
		metadata: { ...candidateProvenance({
			metadata: { ...METADATA, wordCount: params.kind === "image" ? 0 : 5, directResourceKind: params.kind },
			html, evaluationHtml: html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL,
			kind: "live", fetchedAt: params.fetchedAt, httpStatus: 200,
		}), id: CandidateIdSchema.parse(params.id) },
	};
}

function committedAt(canonical: VerifiedTierSource, contentFetchedAt: string = NOW): Partial<Article> {
	return {
		contentSelection: { candidateId: canonical.metadata.id, tier: canonical.tier },
		freshness: { contentFetchedAt, canonicalContentHash: computeCanonicalContentHash(canonical.html) },
	};
}

function article(overrides: Partial<Article> = {}): Article {
	return {
		url: URL, metadata: METADATA, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 1,
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Existing summary" }, summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

function setup(sources: TierSource[], overrides: Partial<Parameters<typeof initPrepareContentSelection>[0]> = {}) {
	const judge = jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>()
		.mockImplementation(async ({ candidates }) => ({
			kind: "none", reason: "No prose article",
			readability: candidates.map((candidate) => ({ candidateId: candidate.id, readable: false })),
			audit: { judgedCandidates: [], promptHash: "prompt", responseStatus: "completed" },
		}));
	const prepare = initPrepareContentSelection({
		loadArticle: async () => article(), readCanonicalContent: async () => undefined,
		listAvailableTierSources: async () => sources, judge: initJudgeUnderLedger({ selectMostCompleteContent: judge, runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => new Date(NOW) }), logger: noopLogger, now: () => new Date(NOW) }), claimTtlMs: 60_000 }),
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => ({ originalUrl: URL, sourceUrl: ARCHIVE }),
		...overrides,
	});
	return {
		prepare: (params: { candidates: readonly VerifiedTierSource[]; saveAttemptId?: SaveAttemptId; mode?: SelectionMode }) => prepare({
			url: URL, saveAttemptId: params.saveAttemptId ?? A1, claimId: "message-1", mode: params.mode ?? "save",
			candidates: params.candidates.map((candidate) => ({ id: candidate.metadata.id, tier: candidate.tier })),
		}),
		judge,
	};
}

describe("a direct resource fetched before another attempt's committed canonical", () => {
	it.each(["save", "refresh"] satisfies SelectionMode[])("refuses an older attempt's direct resource when another attempt's canonical was fetched later (%s)", async (mode) => {
		const stale = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const canonical = resource({ kind: "image", id: "c2", attemptId: A2, fetchedAt: T2 });
		const { prepare, judge } = setup([canonical, stale], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [stale], mode });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical" });
		expect(result.selected).toEqual(canonical);
	});

	it("refuses every superseded resource when the attempt holds two", async () => {
		const image = resource({ kind: "image", id: "c1-image", attemptId: A1, fetchedAt: T1 });
		const text = resource({ kind: "plain-text", id: "c1-text", attemptId: A1, fetchedAt: T1 });
		const canonical = resource({ kind: "image", id: "c2", attemptId: A2, fetchedAt: T2 });
		const { prepare, judge } = setup([canonical, image, text], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [image, text] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "superseded-by-canonical" });
		expect(result.selected).toEqual(canonical);
	});

	it("selects the current resource when one of the attempt's two is superseded", async () => {
		const older = resource({ kind: "image", id: "c1-older", attemptId: A1, fetchedAt: T1 });
		const current = resource({ kind: "image", id: "c1-current", attemptId: A1, fetchedAt: NOW });
		const canonical = resource({ kind: "image", id: "c2", attemptId: A2, fetchedAt: T2 });
		const { prepare, judge } = setup([canonical, older, current], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [older, current] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(current);
		expect(result.readableIds).toEqual(new Set([current.metadata.id]));
	});
});

describe("a direct resource the fence must not refuse", () => {
	it("selects the in-order resource when the row's contentFetchedAt is later than its fetchedAt but the canonical's manifest is older", async () => {
		const fresh = resource({ kind: "image", id: "c2", attemptId: A2, fetchedAt: T2 });
		const canonical = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const { prepare, judge } = setup([canonical, fresh], { loadArticle: async () => article(committedAt(canonical, NOW)) });

		const result = await prepare({ candidates: [fresh], saveAttemptId: A2 });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(fresh);
	});

	it("selects over a legacy canonical whose synthesized fetchedAt is later", async () => {
		const legacyHtml = "<pre>Legacy body.</pre>";
		const stale = resource({ kind: "plain-text", id: "c1", attemptId: A1, fetchedAt: T1 });
		const { prepare, judge } = setup([stale], {
			loadArticle: async () => article({ contentSelection: { tier: "tier-1" }, freshness: { contentFetchedAt: T2, canonicalContentHash: computeCanonicalContentHash(legacyHtml) } }),
			readCanonicalContent: async () => ({ content: legacyHtml }),
		});

		const result = await prepare({ candidates: [stale] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(stale);
	});

	it("selects over a same-attempt canonical that has no directResourceKind, fetched later", async () => {
		const stale = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const canonical = resource({ kind: "plain-text", id: "c1-prose", attemptId: A1, fetchedAt: T2 });
		canonical.metadata.directResourceKind = undefined;
		const { prepare, judge } = setup([canonical, stale], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [stale] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(stale);
	});

	it("selects over a tier-2 canonical fetched later", async () => {
		const stale = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const archived = resource({ kind: "image", id: "c2-archive", attemptId: A2, fetchedAt: T2 });
		const canonical: VerifiedTierSource = { ...archived, tier: "tier-2", metadata: { ...archived.metadata, kind: "wrapper", sourceUrl: ARCHIVE, directResourceKind: undefined } };
		const { prepare, judge } = setup([canonical, stale], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [stale] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(stale);
	});

	it("selects over a wrapper-host tier-1 canonical fetched later", async () => {
		const stale = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const wrapped = resource({ kind: "image", id: "c2-wrapped", attemptId: A2, fetchedAt: T2 });
		const canonical: VerifiedTierSource = { ...wrapped, metadata: { ...wrapped.metadata, sourceUrl: ARCHIVE } };
		const { prepare, judge } = setup([canonical, stale], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [stale] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(stale);
	});

	it("selects over a canonical fetched earlier", async () => {
		const fresh = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T2 });
		const canonical = resource({ kind: "image", id: "c2", attemptId: A2, fetchedAt: T1 });
		const { prepare, judge } = setup([canonical, fresh], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [fresh] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(fresh);
	});

	it("selects when the later canonical is unreadable", async () => {
		const stale = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const blank = resource({ kind: "image", id: "c2-blank", attemptId: A2, fetchedAt: T2 });
		const html = "<div></div>";
		const canonical: VerifiedTierSource = { ...blank, html, metadata: { ...blank.metadata, contentHash: candidateProvenance({ metadata: blank.metadata, html, evaluationHtml: html, attemptId: A2, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: T2 }).contentHash } };
		const { prepare, judge } = setup([canonical, stale], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [stale] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(stale);
	});

	it("retains a same-attempt direct-resource canonical fetched later", async () => {
		const stale = resource({ kind: "image", id: "c1", attemptId: A1, fetchedAt: T1 });
		const canonical = resource({ kind: "image", id: "c1-later", attemptId: A1, fetchedAt: T2 });
		const { prepare, judge } = setup([canonical, stale], { loadArticle: async () => article(committedAt(canonical)) });

		const result = await prepare({ candidates: [stale] });

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "direct-resource" });
		expect(result.selected).toEqual(canonical);
		expect(result.readableIds).toEqual(new Set([canonical.metadata.id, stale.metadata.id]));
	});
});
