import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import type { Article } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/hutch-logger";
import { candidateProvenance } from "./candidate-provenance";
import { initLogContentSelection, initPrepareContentSelection } from "./prepare-content-selection";
import type { SelectMostCompleteContent } from "./select-content";
import type { TierSource, VerifiedTierSource } from "./tier-source.types";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";

const URL = "https://example.com/resource";
const ARCHIVE = "https://archive.ph/abc12";
const NOW = "2026-10-22T00:00:00.000Z";
const ATTEMPT = SaveAttemptIdSchema.parse("current-attempt");
const EARLIER = SaveAttemptIdSchema.parse("earlier-attempt");
const METADATA = { title: "Resource", siteName: "example.com", excerpt: "", wordCount: 0, estimatedReadTime: 1 };

function resource(kind: "image" | "plain-text", id: string = kind): VerifiedTierSource {
	const html = kind === "image" ? '<img src="https://cdn.example/resource.png">' : "<pre>One short line.</pre>";
	return {
		tier: "tier-1", html,
		metadata: { ...candidateProvenance({
			metadata: { ...METADATA, wordCount: kind === "image" ? 0 : 3, directResourceKind: kind },
			html, evaluationHtml: html, attemptId: ATTEMPT, originalUrl: URL, sourceUrl: URL,
			kind: "live", fetchedAt: NOW, httpStatus: 200,
		}), id: CandidateIdSchema.parse(id) },
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
		listAvailableTierSources: async () => sources, selectMostCompleteContent: judge,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => ({ originalUrl: URL, sourceUrl: ARCHIVE }),
		...overrides,
	});
	return { prepare: (candidates?: Parameters<typeof prepare>[0]["candidates"]) => prepare({ url: URL, saveAttemptId: ATTEMPT, candidates }), judge };
}

describe("verified direct resource selection", () => {
	it.each(["image", "plain-text"] satisfies Array<"image" | "plain-text">)("serves a fetched %s resource without asking the prose judge", async (kind) => {
		const source = resource(kind);
		const { prepare, judge } = setup([source]);

		const result = await prepare([{ id: source.metadata.id, tier: source.tier }]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource", audit: undefined, ownCaptureFailed: false });
		expect(result.selected).toEqual(source);
		expect(result.readableIds).toEqual(new Set([source.metadata.id]));
	});

	it("uses the current attempt's resource despite historical candidates and rejected provenance", async () => {
		const old = resource("plain-text", "historical");
		old.metadata.attemptId = EARLIER;
		old.metadata.directResourceKind = undefined;
		const invalid = resource("image", "rejected");
		invalid.metadata.contentHash = "wrong-hash";
		const fresh = resource("image", "fresh");
		const { prepare, judge } = setup([old, invalid, fresh]);

		const result = await prepare([{ id: fresh.metadata.id, tier: fresh.tier }]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result.selected?.metadata.id).toBe(fresh.metadata.id);
		expect(result.sources.map((source) => source.metadata.id)).toEqual([old.metadata.id, fresh.metadata.id]);
		expect(result.readableIds).toEqual(new Set([fresh.metadata.id]));
	});

	it("selects a current resource over a different committed canonical during recrawl", async () => {
		const canonical = resource("plain-text", "canonical");
		canonical.metadata.attemptId = EARLIER;
		const fresh = resource("image", "fresh");
		const { prepare, judge } = setup([canonical, fresh], {
			loadArticle: async () => article({
				contentSelection: { candidateId: canonical.metadata.id, tier: canonical.tier },
				freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(canonical.html) },
			}),
		});

		const result = await prepare([{ id: fresh.metadata.id, tier: fresh.tier }]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "direct-resource" });
		expect(result.selected?.metadata.id).toBe(fresh.metadata.id);
	});

	it("retains a current resource already committed by the same attempt", async () => {
		const canonical = resource("image", "canonical");
		const fresh = resource("image", "fresh");
		const { prepare, judge } = setup([canonical, fresh], {
			loadArticle: async () => article({ contentSelection: { candidateId: canonical.metadata.id, tier: canonical.tier }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(canonical.html) } }),
		});

		const result = await prepare([{ id: fresh.metadata.id, tier: fresh.tier }]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "retained", selectionRule: "direct-resource" });
		expect(result.selected?.metadata.id).toBe(canonical.metadata.id);
		expect(result.readableIds).toEqual(new Set([canonical.metadata.id, fresh.metadata.id]));
	});

	it("uses the existing fresh-candidate tie preference among eligible resources", async () => {
		const first = resource("image", "first");
		const fresh = resource("image", "fresh");
		const { prepare, judge } = setup([first, fresh]);

		const result = await prepare([{ id: fresh.metadata.id, tier: fresh.tier }]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result.selected?.metadata.id).toBe(fresh.metadata.id);
		expect(result.readableIds).toEqual(new Set([first.metadata.id, fresh.metadata.id]));
	});

	it("preserves first-capture precedence for a tapped browser capture carrying resource metadata", async () => {
		const capture = resource("image", "capture");
		capture.tier = "tier-0";
		capture.metadata.kind = "extension";
		capture.metadata.captureTrigger = "manual";
		const { prepare, judge } = setup([capture]);

		const result = await prepare([{ id: capture.metadata.id, tier: capture.tier }]);

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ outcome: "selected", selectionRule: "first-capture" });
		expect(result.selected?.metadata.id).toBe(capture.metadata.id);
	});

	const ineligible: Array<{ name: string; change: (source: VerifiedTierSource) => void; verified: boolean }> = [
		{ name: "a historical resource", change: (source) => { source.metadata.attemptId = EARLIER; }, verified: true },
		{ name: "a resource without fetched resource evidence", change: (source) => { source.metadata.directResourceKind = undefined; }, verified: true },
		{ name: "an automatic capture", change: (source) => { source.tier = "tier-0"; source.metadata.kind = "extension"; source.metadata.captureTrigger = "automatic"; }, verified: true },
		{ name: "a wrapper candidate", change: (source) => { source.tier = "tier-2"; source.metadata.kind = "wrapper"; source.metadata.sourceUrl = ARCHIVE; }, verified: true },
		{ name: "a live candidate fetched on a wrapper host", change: (source) => { source.metadata.sourceUrl = ARCHIVE; }, verified: true },
		{ name: "an extension kind in the live tier", change: (source) => { source.metadata.kind = "extension"; }, verified: false },
		{ name: "a live kind in the extension tier", change: (source) => { source.tier = "tier-0"; }, verified: false },
		{ name: "a different original identity", change: (source) => { source.metadata.originalUrl = "https://other.example/resource"; }, verified: false },
		{ name: "an invalid content hash", change: (source) => { source.metadata.contentHash = "invalid"; }, verified: false },
		{ name: "an HTTP error", change: (source) => { source.metadata.httpStatus = 404; }, verified: true },
		{ name: "a blank materialized body", change: (source) => { source.evaluationHtml = source.html; source.html = " "; }, verified: true },
		{ name: "a body without words or media", change: (source) => { source.evaluationHtml = source.html; source.html = "<div></div>"; }, verified: true },
	];
	it.each(ineligible)("keeps $name on the existing judge path", async ({ change, verified }) => {
		const source = resource("image");
		change(source);
		const { prepare, judge } = setup([source]);

		const result = await prepare([{ id: source.metadata.id, tier: source.tier }]);

		expect(judge).toHaveBeenCalledTimes(verified ? 1 : 0);
		expect(result).toMatchObject({ outcome: "no-readable", selectionRule: "judge", selected: undefined });
		expect(result.readableIds).toEqual(new Set());
	});

	it("does not trust resource evidence on a manifest missing provenance", async () => {
		const source: TierSource = { tier: "tier-1", html: '<img src="https://example.com/resource.png">', metadata: { ...METADATA, directResourceKind: "image" } };
		const { prepare, judge } = setup([source]);

		const result = await prepare();

		expect(judge).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({ sources: [], selected: undefined, outcome: "no-readable", selectionRule: "judge" });
	});

	it("continues judging a valid historical manifest that has no resource evidence", async () => {
		const source = resource("plain-text");
		source.metadata.directResourceKind = undefined;
		const { prepare, judge } = setup([source]);

		const result = await prepare();

		expect(judge).toHaveBeenCalledTimes(1);
		expect(result.sources).toEqual([source]);
		expect(result).toMatchObject({ outcome: "no-readable", selectionRule: "judge" });
	});

	it("logs accepted resource candidates and their deterministic selection rule", async () => {
		const resourceSource = resource("image");
		const old = resource("plain-text", "old");
		old.metadata.attemptId = EARLIER;
		const { prepare } = setup([old, resourceSource]);
		const info = jest.fn();

		initLogContentSelection({ logger: { ...noopLogger, info } })({ saveAttemptId: ATTEMPT, selection: await prepare() });

		expect(info).toHaveBeenCalledWith(expect.stringContaining('"selectedCandidateId":"image","outcome":"selected","selectionRule":"direct-resource"'));
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"httpStatus":200,"readable":true,"fresh":true'));
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"httpStatus":200,"readable":false,"fresh":false'));
	});
});
