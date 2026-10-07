import { SaveAttemptIdSchema, CandidateIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent, type ContentDecision, type SelectMostCompleteContent } from "./select-content";
import { noopLogger } from "@packages/hutch-logger";
import type { Article } from "@packages/domain/article-aggregate";
import { candidateProvenance } from "./candidate-provenance";
import { initLogContentSelection, initPrepareContentSelection } from "./prepare-content-selection";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import type { TierSource, VerifiedTierSource } from "./tier-source.types";

const cid = (id: string) => CandidateIdSchema.parse(id);

const URL = "https://example.com/article";
const ARCHIVE = "https://archive.ph/abc12";
const NOW = "2026-10-05T00:00:00.000Z";
const baseMetadata = { title: "Article", siteName: "example.com", excerpt: "Article excerpt", wordCount: 100, estimatedReadTime: 1 };

function source(tier: TierSource["tier"], id: string, overrides: Partial<VerifiedTierSource> = {}): VerifiedTierSource {
	const html = overrides.html ?? "<p>Complete article</p>";
	return {
		tier, html,
		metadata: { ...candidateProvenance({
			metadata: baseMetadata, html, evaluationHtml: overrides.evaluationHtml ?? html, attemptId: SaveAttemptIdSchema.parse("fresh"),
			originalUrl: URL, sourceUrl: tier === "tier-2" ? ARCHIVE : URL,
			kind: tier === "tier-2" ? "wrapper" : tier === "tier-0" ? "extension" : "live", fetchedAt: NOW,
		}), id: cid(id) },
		...overrides,
	};
}

function article(overrides: Partial<Article> = {}): Article {
	return {
		url: URL, metadata: baseMetadata, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 1,
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Existing summary" }, summaryAutoHeal: { attempts: 0 }, ...overrides,
	};
}

type Dependencies = Omit<Parameters<typeof initPrepareContentSelection>[0], "selectMostCompleteContent"> & {
	selectMostCompleteContent: (params: Parameters<SelectMostCompleteContent>[0]) => Promise<ContentDecision>;
};
function setup(overrides: Partial<Dependencies> = {}) {
	const deps: Dependencies = {
		readCanonicalContent: async () => undefined, loadArticle: async () => article(), listAvailableTierSources: async () => [],
		selectMostCompleteContent: async () => ({ kind: "none", reason: "No readable article" }),
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => ({ originalUrl: URL, sourceUrl: ARCHIVE }),
		...overrides,
	};
	const selectMostCompleteContent: SelectMostCompleteContent = async (params) => {
		const decision = await deps.selectMostCompleteContent(params);
		return initSelectMostCompleteContent({ createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ ...decision, readability: params.candidates.map((candidate) => ({ candidateId: candidate.id, readable: decision.kind === "winner" ? candidate.id === decision.candidateId : decision.kind === "tie" && decision.candidateIds.includes(candidate.id) })) }) } }] }), logger: noopLogger }).selectMostCompleteContent(params);
	};
	return { prepare: initPrepareContentSelection({ ...deps, selectMostCompleteContent }), deps };
}

describe("initPrepareContentSelection", () => {
	it("judges the live body and actual wrapper CAPTCHA together before choosing the live article", async () => {
		const live = source("tier-1", "live");
		const wrapper = source("tier-2", "challenge", { html: "", evaluationHtml: "<html>Verify you are human</html>" });
		wrapper.metadata.wordCount = 0;
		wrapper.metadata.httpStatus = 403;
		const select = jest.fn<ReturnType<Dependencies["selectMostCompleteContent"]>, Parameters<Dependencies["selectMostCompleteContent"]>>()
			.mockResolvedValue({ kind: "winner", candidateId: cid("live"), reason: "Challenge is unreadable" });
		const verify = jest.fn<ReturnType<Dependencies["verifyWrapperSource"]>, Parameters<Dependencies["verifyWrapperSource"]>>()
			.mockResolvedValue({ originalUrl: URL, sourceUrl: ARCHIVE });
		const { prepare } = setup({ listAvailableTierSources: async () => [live, wrapper], selectMostCompleteContent: select, verifyWrapperSource: verify });

		const result = await prepare({ url: URL, candidates: [{ tier: "tier-1", id: cid("live") }, { tier: "tier-2", id: cid("challenge") }] });

		expect(select).toHaveBeenCalledWith({ url: URL, candidates: [
			{ id: cid("live"), tier: "tier-1", title: "Article", wordCount: 100, html: live.html, httpStatus: undefined },
			{ id: cid("challenge"), tier: "tier-2", title: "Article", wordCount: 0, html: wrapper.evaluationHtml, httpStatus: 403 },
		] });
		expect(verify).toHaveBeenCalledWith({ articleUrl: URL, sourceUrl: ARCHIVE, claimedOriginalUrl: URL });
		expect(result.selected?.metadata.id).toBe("live");
		expect(result.outcome).toBe("selected");
		expect(result.readableIds).toEqual(new Set(["live"]));
	});

	it("does not promote a solitary unreadable wrapper when the AI returns none", async () => {
		const wrapper = source("tier-2", "challenge", { html: "<p>CAPTCHA challenge</p>" });
		const select = jest.fn<ReturnType<Dependencies["selectMostCompleteContent"]>, Parameters<Dependencies["selectMostCompleteContent"]>>()
			.mockResolvedValue({ kind: "none", reason: "CAPTCHA" });
		const { prepare } = setup({ listAvailableTierSources: async () => [wrapper], selectMostCompleteContent: select });
		const result = await prepare({ url: URL });
		expect(select).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ selected: undefined, outcome: "no-readable" });
	});

	it("accepts the same original across the declared Twitter and X host aliases", async () => {
		const live = source("tier-1", "live");
		live.metadata.originalUrl = "https://twitter.com/reader/status/1";
		live.metadata.sourceUrl = "https://twitter.com/reader/status/1";
		const { prepare } = setup({ resolveOriginalUrl: async () => "https://x.com/reader/status/1", listAvailableTierSources: async () => [live], selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("live"), reason: "Article" }) });
		expect((await prepare({ url: URL })).selected?.metadata.id).toBe("live");
	});

	it("judges the reader's own capture against a live crawl that was redirected to a login wall", async () => {
		const capture = source("tier-0", "capture");
		capture.metadata.attemptId = SaveAttemptIdSchema.parse("earlier");
		const loginWall = source("tier-1", "login-wall", { html: "<p>Sign in to keep reading</p>" });
		loginWall.metadata.sourceUrl = "https://login.example/wall";
		const select = jest.fn<ReturnType<Dependencies["selectMostCompleteContent"]>, Parameters<Dependencies["selectMostCompleteContent"]>>()
			.mockResolvedValue({ kind: "winner", candidateId: cid("capture"), reason: "The capture is the article" });
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { revision: 1, tier: "tier-0", candidateId: cid("capture") } }),
			listAvailableTierSources: async () => [capture, loginWall],
			selectMostCompleteContent: select,
		});

		const result = await prepare({ url: URL, candidates: [{ tier: "tier-1", id: cid("login-wall") }] });

		expect(select.mock.calls[0]?.[0].candidates.map((candidate) => candidate.id)).toEqual([cid("capture"), cid("login-wall")]);
		expect(result.selected?.metadata.id).toBe("capture");
		expect(result.outcome).toBe("retained");
	});

	it("serves the reader's capture as an article's first content without consulting the judge", async () => {
		const capture = source("tier-0", "capture");
		const select = jest.fn<ReturnType<Dependencies["selectMostCompleteContent"]>, Parameters<Dependencies["selectMostCompleteContent"]>>();
		const { prepare } = setup({ listAvailableTierSources: async () => [capture], selectMostCompleteContent: select });

		const result = await prepare({ url: URL, candidates: [{ tier: "tier-0", id: cid("capture") }] });

		expect(select).not.toHaveBeenCalled();
		expect(result.selected?.metadata.id).toBe("capture");
		expect(result.outcome).toBe("selected");
		expect(result.reason).toBe("the reader's capture is the article's first content");
		expect(result.readableIds.has(cid("capture"))).toBe(true);
		expect(result.audit).toBeUndefined();
	});

	it("does not serve a blank first capture", async () => {
		const blank = source("tier-0", "blank", { html: " " });
		const select = jest.fn<ReturnType<Dependencies["selectMostCompleteContent"]>, Parameters<Dependencies["selectMostCompleteContent"]>>();
		const { prepare } = setup({ listAvailableTierSources: async () => [blank], selectMostCompleteContent: select });

		const result = await prepare({ url: URL, candidates: [{ tier: "tier-0", id: cid("blank") }] });

		expect(select).not.toHaveBeenCalled();
		expect(result.outcome).toBe("no-readable");
	});

	it("still judges a lone capture once the article holds committed content", async () => {
		const capture = source("tier-0", "capture");
		const select = jest.fn<ReturnType<Dependencies["selectMostCompleteContent"]>, Parameters<Dependencies["selectMostCompleteContent"]>>()
			.mockResolvedValue({ kind: "none", reason: "The capture is a challenge page" });
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { revision: 2, tier: "tier-1", candidateId: cid("gone") }, freshness: { contentFetchedAt: NOW, canonicalContentHash: "committed" } }),
			listAvailableTierSources: async () => [capture],
			selectMostCompleteContent: select,
		});

		const result = await prepare({ url: URL, candidates: [{ tier: "tier-0", id: cid("capture") }] });

		expect(select).toHaveBeenCalledTimes(1);
		expect(result.outcome).toBe("no-readable");
	});

	it("retains a verified earlier canonical when all fresh responses are unreadable", async () => {
		const previous = source("tier-0", "previous");
		previous.metadata.attemptId = SaveAttemptIdSchema.parse("earlier");
		const fresh = source("tier-2", "challenge");
		const expected = { revision: 7, tier: "tier-0" as const, candidateId: cid("previous") };
		const list = jest.fn<ReturnType<Dependencies["listAvailableTierSources"]>, Parameters<Dependencies["listAvailableTierSources"]>>()
			.mockResolvedValue([previous, fresh]);
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: expected }), listAvailableTierSources: list });
		const candidates = [{ tier: "tier-2" as const, id: cid("challenge") }];
		const result = await prepare({ url: URL, candidates });
		expect(result.selected?.metadata.id).toBe("previous");
		expect(result.outcome).toBe("retained");
		expect(result.article.contentSelection).toBe(expected);
		expect(result.readableIds).toEqual(new Set());
		expect(list).toHaveBeenCalledWith(URL, { candidates, canonical: { id: cid("previous"), tier: "tier-0" } });
	});
	it("retains a prior canonical on redelivery without overriding its current unreadable verdict", async () => {
		const previous = source("tier-2", "same-wrapper");
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { revision: 2, candidateId: previous.metadata.id, tier: "tier-2" } }),
			listAvailableTierSources: async () => [previous],
			selectMostCompleteContent: async () => ({ kind: "none", reason: "The candidate is a challenge page" }),
		});
		const selection = await prepare({ url: URL, candidates: [{ id: previous.metadata.id, tier: "tier-2" }] });
		expect(selection.selected).toEqual(previous);
		expect(selection.outcome).toBe("retained");
		expect(selection.readableIds).toEqual(new Set());
		expect(selection.audit?.responseStatus).toBe("completed");
		const info = jest.fn();
		initLogContentSelection({ logger: { ...noopLogger, info } })({ saveAttemptId: SaveAttemptIdSchema.parse("fresh"), selection, liveAttempt: { outcome: "no-body" } });
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"readable":false,"fresh":true'));
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"selectedCandidateId":"same-wrapper","outcome":"retained"'));
	});

	it.each([
		["unknown original", { originalUrl: "https://other.example/article" }],
		["mismatched bytes", { contentHash: "0".repeat(64) }],
		["revoked candidate", { id: "revoked" }],
		["live falsely marked wrapper", { kind: "wrapper" }],
	] as const)("rejects %s before comparison", async (_label, fields) => {
		const invalid = source("tier-1", "invalid");
		Object.assign(invalid.metadata, fields);
		const select = jest.fn();
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { revokedCandidateIds: [cid("revoked")] } }),
			listAvailableTierSources: async () => [invalid], selectMostCompleteContent: select,
		});
		expect((await prepare({ url: URL })).outcome).toBe("no-readable");
		expect(select).not.toHaveBeenCalled();
	});

	it.each(["tier-0", "tier-2"] as const)("rejects a %s candidate carrying live provenance", async (tier) => {
		const invalid = source(tier, "invalid");
		invalid.metadata.kind = "live";
		const { prepare } = setup({ listAvailableTierSources: async () => [invalid] });
		expect((await prepare({ url: URL })).sources).toEqual([]);
	});

	it("rejects wrapper provenance whose original cannot be independently verified", async () => {
		const { prepare } = setup({ listAvailableTierSources: async () => [source("tier-2", "invalid")], verifyWrapperSource: async () => undefined });
		expect((await prepare({ url: URL })).sources).toEqual([]);
	});

	it.each([ARCHIVE, "https://archive.ph/unrecognized/wrapper"])("also independently verifies an extension captured on wrapper host %s", async (sourceUrl) => {
		const extension = source("tier-0", "extension");
		extension.metadata.sourceUrl = sourceUrl;
		const verify = jest.fn<ReturnType<Dependencies["verifyWrapperSource"]>, Parameters<Dependencies["verifyWrapperSource"]>>().mockResolvedValue(undefined);
		const { prepare } = setup({ listAvailableTierSources: async () => [extension], verifyWrapperSource: verify });
		expect((await prepare({ url: URL })).sources).toEqual([]);
		expect(verify).toHaveBeenCalledTimes(1);
	});

	it("retains legacy direct canonical bytes only when their hash matches the stored canonical", async () => {
		const legacy: TierSource = { tier: "tier-1", html: "<p>Legacy direct article</p>", metadata: baseMetadata };
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-1" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy.html) } }),
			listAvailableTierSources: async () => [legacy],
		});
		const result = await prepare({ url: URL });
		expect(result.outcome).toBe("retained");
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", originalUrl: URL, sourceUrl: URL, kind: "live" });
	});

	it("preserves an attributed legacy direct extension with an explicit matching display and source URL", async () => {
		const legacy: TierSource = { tier: "tier-0", html: "<p>Extension article</p>", evaluationHtml: "<html>Full extension article</html>", metadata: { ...baseMetadata, sourceUrl: URL, authorUserId: "extension-author" } };
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-0", displayUrl: URL }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy.html) } }),
			listAvailableTierSources: async () => [legacy],
		});
		const result = await prepare({ url: URL });
		expect(result.outcome).toBe("retained");
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", kind: "extension", authorUserId: "extension-author" });
	});

	it.each(["content-too-short", "ai-unavailable"] as const)("preserves summary retry semantics on a prose tie with skipped reason %s", async (reason) => {
		const extension = source("tier-0", "extension");
		const live = source("tier-1", "live");
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-0", candidateId: cid("extension") }, summary: { kind: "skipped", reason } }),
			listAvailableTierSources: async () => [extension, live],
			selectMostCompleteContent: async () => ({ kind: "tie", candidateIds: [cid("extension"), cid("live")], reason: "Equal prose" }),
		});
		const result = await prepare({ url: URL });
		expect(result.selected?.metadata.id).toBe(reason === "content-too-short" ? "live" : "extension");
		expect(result.outcome).toBe(reason === "content-too-short" ? "selected" : "retained");
	});

	it.each([
		{ tier: "tier-2" as const }, { tier: "tier-1" as const, contentSourceUrl: ARCHIVE },
		{ tier: "tier-1" as const, displayUrl: ARCHIVE }, { tier: "tier-1" as const, sourceUrl: ARCHIVE },
		{ tier: "tier-1" as const, badHash: true },
	])("does not reconstruct unverified wrapper or mismatched legacy canonical provenance: %j", async (options) => {
		const legacy: TierSource = { tier: options.tier, html: "<p>Unverified old content</p>", metadata: { ...baseMetadata, sourceUrl: options.sourceUrl } };
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: options, freshness: { contentFetchedAt: NOW, canonicalContentHash: options.badHash ? "wrong" : computeCanonicalContentHash(legacy.html) } }),
			listAvailableTierSources: async () => [legacy],
		});
		expect((await prepare({ url: URL })).sources).toEqual([]);
	});

	it("chooses only AI-tied candidates and switches an archived canonical to an equally complete live body", async () => {
		const extension = source("tier-0", "extension");
		const live = source("tier-1", "live");
		const archive = source("tier-2", "archive");
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-2", candidateId: cid("archive") } }),
			listAvailableTierSources: async () => [extension, archive, live],
			selectMostCompleteContent: async () => ({ kind: "tie", candidateIds: [cid("archive"), cid("live")], reason: "Equal" }),
		});
		expect((await prepare({ url: URL, candidates: [{ tier: "tier-1", id: cid("live") }] })).selected?.metadata.id).toBe("live");
	});

	it("does not promote blank parsed HTML even if the model names it a winner", async () => {
		const blank = source("tier-1", "blank", { html: " ", evaluationHtml: "<html>CAPTCHA</html>" });
		const { prepare } = setup({ listAvailableTierSources: async () => [blank], selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("blank"), reason: "Mistake" }) });
		expect((await prepare({ url: URL })).outcome).toBe("no-readable");
	});

	it("promotes a media-only winner that carries no prose", async () => {
		const media = source("tier-1", "media", { html: '<img src="https://example.com/photo.jpg">' });
		media.metadata.wordCount = 0;
		const { prepare } = setup({ listAvailableTierSources: async () => [media], selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("media"), reason: "Photo essay" }) });
		expect((await prepare({ url: URL })).outcome).toBe("selected");
	});

	it("does not promote a winner whose markup holds neither prose nor media", async () => {
		const markup = source("tier-1", "markup", { html: "<div></div>" });
		markup.metadata.wordCount = 0;
		const { prepare } = setup({ listAvailableTierSources: async () => [markup], selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("markup"), reason: "Mistake" }) });
		expect((await prepare({ url: URL })).outcome).toBe("no-readable");
	});

	it("rejects an invalid judge response so the selection is retried rather than committed as unreadable", async () => {
		const { prepare } = setup({ listAvailableTierSources: async () => [source("tier-1", "live")], selectMostCompleteContent: async () => { throw new Error("judge returned an invalid response: unknown winner candidate"); } });
		await expect(prepare({ url: URL })).rejects.toThrow("judge returned an invalid response");
	});

	it.each([
		{ label: "a readable 2xx body", httpStatus: 200, expected: { outcome: "selected", id: "live" } },
		{ label: "only a 403 body", httpStatus: 403, expected: { outcome: "no-readable", id: undefined } },
	])("falls back on a judge-provider rejection to $label", async ({ httpStatus, expected }) => {
		const live = source("tier-1", "live");
		live.metadata.httpStatus = httpStatus;
		const rejectingJudge = initSelectMostCompleteContent({ createChatCompletion: async () => { throw Object.assign(new Error("bad request"), { status: 400 }); }, logger: noopLogger }).selectMostCompleteContent;
		const prepare = initPrepareContentSelection({
			readCanonicalContent: async () => undefined, loadArticle: async () => article(), listAvailableTierSources: async () => [live],
			selectMostCompleteContent: rejectingJudge, resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		});
		const result = await prepare({ url: URL, candidates: [{ tier: "tier-1", id: cid("live") }] });
		expect(result.audit?.responseStatus).toBe("rejected");
		expect(result.outcome).toBe(expected.outcome);
		expect(result.selected?.metadata.id).toBe(expected.id);
	});

	it("does not promote an unreadable 2xx body on a judge-provider rejection", async () => {
		const blank = source("tier-1", "blank", { html: "<div></div>" });
		blank.metadata.wordCount = 0;
		blank.metadata.httpStatus = 200;
		const rejectingJudge = initSelectMostCompleteContent({ createChatCompletion: async () => { throw Object.assign(new Error("bad request"), { status: 400 }); }, logger: noopLogger }).selectMostCompleteContent;
		const prepare = initPrepareContentSelection({
			readCanonicalContent: async () => undefined, loadArticle: async () => article(), listAvailableTierSources: async () => [blank],
			selectMostCompleteContent: rejectingJudge, resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		});
		expect((await prepare({ url: URL })).outcome).toBe("no-readable");
	});

	it("requires an existing aggregate before evaluating content", async () => {
		const { prepare } = setup({ loadArticle: async () => undefined });
		await expect(prepare({ url: URL })).rejects.toThrow("Article aggregate not found");
	});
});

describe("initLogContentSelection", () => {
	it("correlates the exact fresh CAPTCHA and retained prior winner without claiming challenge readability", async () => {
		const previous = source("tier-0", "previous");
		previous.metadata.attemptId = SaveAttemptIdSchema.parse("earlier");
		const wrapper = source("tier-2", "captcha", { evaluationHtml: "<html>Verify you are human</html>" });
		wrapper.metadata.evaluationLocation = "articles/example/sources/tier-2.html.candidates/hash/evaluation.html";
		wrapper.metadata.httpStatus = 403;
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: { tier: "tier-0", candidateId: cid("previous") } }), listAvailableTierSources: async () => [previous, wrapper] });
		const selection = await prepare({ url: URL });
		const info = jest.fn();
		initLogContentSelection({ logger: { ...noopLogger, info } })({ saveAttemptId: SaveAttemptIdSchema.parse("fresh"), selection, liveAttempt: { outcome: "no-body" } });
		expect(info).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify({ id: "captcha", kind: "wrapper", originalUrl: URL, sourceUrl: ARCHIVE, contentHash: wrapper.metadata.contentHash, httpStatus: 403, readable: false, fresh: true, fetchedAt: NOW, evaluationLocation: wrapper.metadata.evaluationLocation })));
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"selectedCandidateId":"previous","outcome":"retained"'));
	});
	it("retains the stored legacy canonical after a fresh tier-1 slot replaces its sidecar", async () => {
		const html = "<p>A complete earlier article with useful content</p>";
		const fresh = source("tier-1", "challenge", { html: "<p>Verify you are human</p>" });
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: { tier: "tier-1" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(html) } }), listAvailableTierSources: async () => [fresh], readCanonicalContent: async () => ({ content: html }) });
		const result = await prepare({ url: URL, candidates: [{ id: cid("challenge"), tier: "tier-1" }] });
		expect(result.outcome).toBe("retained");
		expect(result.selected?.html).toBe(html);
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", authorUserId: undefined });
		expect(result.sources).toHaveLength(2);
	});

	it("attributes a stored legacy capture to the author of the unreplaced legacy tier-0 sidecar", async () => {
		const html = "<p>The canonical reader built from the earlier capture.</p>";
		const sidecar: TierSource = { tier: "tier-0", html: "<p>The raw earlier capture.</p>", metadata: { ...baseMetadata, authorUserId: "alice" } };
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: { tier: "tier-0" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(html) } }), listAvailableTierSources: async () => [sidecar], readCanonicalContent: async () => ({ content: html }) });
		const result = await prepare({ url: URL });
		expect(result.selected?.html).toBe(html);
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", kind: "extension", authorUserId: "alice" });
	});

	it("does not build the stored legacy capture under a co-saver whose candidate replaced the tier-0 pointer", async () => {
		const html = "<p>The first author's capture stored before candidates existed.</p>";
		const coSaver = source("tier-0", "bob-capture", { html: "<p>Verify you are human</p>" });
		coSaver.metadata.authorUserId = "bob";
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: { tier: "tier-0" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(html) } }), listAvailableTierSources: async () => [coSaver], readCanonicalContent: async () => ({ content: html }) });
		const result = await prepare({ url: URL, candidates: [{ id: cid("bob-capture"), tier: "tier-0" }] });
		expect(result.sources.map((candidate) => candidate.metadata.id)).toEqual([cid("bob-capture")]);
		expect(result.outcome).toBe("no-readable");
		expect(result.legacyCanonicalWithheld).toBe(true);
	});

	it("leaves an erased legacy capture out once its removal cleared the stored hash", async () => {
		const erased = "<p>The extension capture its author asked to remove.</p>";
		const survivingCrawl: TierSource = { tier: "tier-1", html: "<p>The crawl stored before candidates carried provenance.</p>", metadata: baseMetadata };
		const readCanonicalContent = jest.fn(async () => ({ content: erased }));
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-0" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: undefined } }),
			listAvailableTierSources: async () => [survivingCrawl], readCanonicalContent,
		});
		const result = await prepare({ url: URL });
		expect(readCanonicalContent).toHaveBeenCalledTimes(0);
		expect(result.sources).toEqual([]);
		expect(result.outcome).toBe("no-readable");
	});

	it.each([undefined, { content: "<p>An unrelated body with a different hash</p>" }])("refuses absent or hash-mismatched legacy canonical bytes: %j", async (persisted) => {
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: { tier: "tier-1" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: "expected-hash" } }), readCanonicalContent: async () => persisted });
		expect((await prepare({ url: URL })).outcome).toBe("no-readable");
	});

	it("retains the hash-matched direct legacy reader when its display URL is a publisher URL", async () => {
		const html = "<p>The complete reader survives the overwritten source slot.</p>";
		const fresh = source("tier-1", "challenge", { html: "<p>Verify you are human</p>" });
		const readCanonicalContent = jest.fn(async () => ({ content: html }));
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-1", displayUrl: `${URL}?edition=print` }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(html) } }),
			listAvailableTierSources: async () => [fresh], readCanonicalContent,
		});
		const result = await prepare({ url: URL, candidates: [{ id: cid("challenge"), tier: "tier-1" }] });
		expect(readCanonicalContent).toHaveBeenCalledWith(URL);
		expect(result.outcome).toBe("retained");
		expect(result.selected?.html).toBe(html);
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", originalUrl: URL, sourceUrl: URL, kind: "live" });
	});

	it("retains a legacy direct canonical pinned to a wrapper afterwards when both fresh candidates are unreadable", async () => {
		const html = "<p>The complete direct article stored before the wrapper was pinned.</p>";
		const live = source("tier-1", "dead-origin", { html: "<p>Not found</p>" });
		const wrapper = source("tier-2", "challenge", { html: "<p>Verify you are human</p>" });
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-1", contentSourceUrl: ARCHIVE, sourceOriginalUrl: URL, directContentBeforePin: true }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(html) } }),
			listAvailableTierSources: async () => [live, wrapper], readCanonicalContent: async () => ({ content: html }),
		});
		const result = await prepare({ url: URL, candidates: [{ id: cid("dead-origin"), tier: "tier-1" }, { id: cid("challenge"), tier: "tier-2" }] });
		expect(result.outcome).toBe("retained");
		expect(result.selected?.html).toBe(html);
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", originalUrl: URL, sourceUrl: URL, kind: "live" });
		expect(result.sources).toHaveLength(3);
	});

	it("retains a listed legacy direct canonical that was pinned to a wrapper afterwards", async () => {
		const legacy: TierSource = { tier: "tier-1", html: "<p>Legacy direct article</p>", metadata: baseMetadata };
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-1", contentSourceUrl: ARCHIVE, sourceOriginalUrl: URL, directContentBeforePin: true }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy.html) } }),
			listAvailableTierSources: async () => [legacy],
		});
		const result = await prepare({ url: URL });
		expect(result.outcome).toBe("retained");
		expect(result.selected?.metadata).toMatchObject({ attemptId: "legacy-direct-canonical", originalUrl: URL, sourceUrl: URL, kind: "live" });
	});

	it("still refuses the stored bytes of a row that carried a wrapper pin before content provenance existed", async () => {
		const legacy: TierSource = { tier: "tier-1", html: "<p>Possibly archive bytes stored as live</p>", metadata: baseMetadata };
		const readCanonicalContent = jest.fn(async () => ({ content: legacy.html }));
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-1", contentSourceUrl: ARCHIVE, sourceOriginalUrl: URL }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy.html) } }),
			listAvailableTierSources: async () => [legacy], readCanonicalContent,
		});
		const result = await prepare({ url: URL });
		expect(result.outcome).toBe("no-readable");
		expect(result.sources).toEqual([]);
		expect(readCanonicalContent).not.toHaveBeenCalled();
	});

	it("keeps the committed wrapper canonical when its source cannot be re-resolved", async () => {
		const committed = source("tier-2", "committed-archive");
		committed.metadata.attemptId = SaveAttemptIdSchema.parse("earlier");
		const fresh = source("tier-1", "challenge", { html: "<p>Verify you are human</p>" });
		const verify = jest.fn<ReturnType<Dependencies["verifyWrapperSource"]>, Parameters<Dependencies["verifyWrapperSource"]>>().mockResolvedValue(undefined);
		const { prepare } = setup({
			loadArticle: async () => article({ contentSelection: { revision: 3, candidateId: cid("committed-archive"), tier: "tier-2" } }),
			listAvailableTierSources: async () => [committed, fresh], verifyWrapperSource: verify,
		});
		const result = await prepare({ url: URL, candidates: [{ id: cid("challenge"), tier: "tier-1" }] });
		expect(result.outcome).toBe("retained");
		expect(result.selected).toEqual(committed);
		expect(verify).not.toHaveBeenCalled();
	});

	it("does not promote an old archive-bearing sidecar through the legacy canonical fallback", async () => {
		const legacy: TierSource = { tier: "tier-1", html: "<p>Old archive copy</p>", metadata: { ...baseMetadata, sourceUrl: ARCHIVE } };
		const readCanonicalContent = jest.fn(async () => ({ content: legacy.html }));
		const { prepare } = setup({ loadArticle: async () => article({ contentSelection: { tier: "tier-1" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy.html) } }), listAvailableTierSources: async () => [legacy], readCanonicalContent });
		expect((await prepare({ url: URL })).outcome).toBe("no-readable");
		expect(readCanonicalContent).not.toHaveBeenCalled();
	});

});
