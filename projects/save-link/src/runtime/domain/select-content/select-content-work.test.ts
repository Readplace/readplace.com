import { SaveAttemptIdSchema, CandidateIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent, type ContentDecision, type SelectMostCompleteContent } from "./select-content";
import { noopLogger } from "@packages/hutch-logger";
import { type Article, type CanonicalCommit, type TransitionAndPersist, promoteTier, recrawlPromoteTier, recrawlTieKeptCanonical, refreshContent } from "@packages/domain/article-aggregate";
import { initSelectContentWork, type SelectContentDependencies } from "./select-content-work";
import { candidateProvenance } from "./candidate-provenance";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { markNoReadableArticle } from "./mark-no-readable-article";
import type { VerifiedTierSource } from "./tier-source.types";

const cid = (id: string) => CandidateIdSchema.parse(id);

const URL = "https://example.com/article";
const NOW = "2026-10-05T00:00:00.000Z";
const metadata = { title: "Complete article", siteName: "example.com", excerpt: "Excerpt", wordCount: 100, estimatedReadTime: 3, authorUserId: "original-author" };
function source(tier: VerifiedTierSource["tier"] = "tier-1"): VerifiedTierSource {
	const html = "<p>Complete article</p>";
	return { tier, html, metadata: { ...candidateProvenance({
		metadata, html, evaluationHtml: html, attemptId: SaveAttemptIdSchema.parse("attempt"), originalUrl: URL,
		sourceUrl: tier === "tier-2" ? "https://archive.ph/abc12" : URL,
		kind: tier === "tier-0" ? "extension" : tier === "tier-2" ? "wrapper" : "live", fetchedAt: NOW,
	}), id: cid(tier) } };
}
function article(overrides: Partial<Article> = {}): Article {
	return { url: URL, metadata, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 3,
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Summary" }, summaryAutoHeal: { attempts: 0 }, ...overrides };
}
type TestDependencies = Omit<SelectContentDependencies, "selectMostCompleteContent"> & {
	selectMostCompleteContent: (params: Parameters<SelectMostCompleteContent>[0]) => Promise<ContentDecision>;
};
function setup(overrides: Partial<TestDependencies> = {}) {
	const stored: Omit<CanonicalCommit, "expected"> = {
		contentLocation: "s3://bucket/immutable/content.html", candidateId: cid("tier-1"),
		originalUrl: URL, tier: "tier-1",
	};
	const commit: CanonicalCommit = { ...stored, expected: undefined };
	const events: string[] = [];
	const transitionAndPersist: TransitionAndPersist = jest.fn(async () => { events.push("commit"); });
	const deps: TestDependencies = {
		listAvailableTierSources: async () => [source()],
		selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("tier-1"), reason: "Most complete" }),
		writeCanonicalContent: jest.fn(async () => { events.push("upload"); return stored; }),
		recordCrawlVersion: jest.fn(async () => { events.push("version"); }),
		readCanonicalContent: async () => undefined, loadArticle: async () => article(), transitionAndPersist,
		resolveOriginalUrl: async () => URL,
		verifyWrapperSource: async () => ({ originalUrl: URL, sourceUrl: "https://archive.ph/abc12" }),
		now: () => new Date(NOW), logger: { ...noopLogger, info: jest.fn(() => { events.push("completion"); }) },
		...overrides,
	};
	const selectMostCompleteContent: SelectMostCompleteContent = async (params) => {
		const decision = await deps.selectMostCompleteContent(params);
		return initSelectMostCompleteContent({ createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ ...decision, readability: params.candidates.map((candidate) => ({ candidateId: candidate.id, readable: decision.kind === "winner" ? candidate.id === decision.candidateId : decision.kind === "tie" && decision.candidateIds.includes(candidate.id) })) }) } }] }), logger: noopLogger }).selectMostCompleteContent(params);
	};
	return { work: initSelectContentWork({ ...deps, selectMostCompleteContent }), deps, commit, events };
}
const request = { url: URL, saveAttemptId: SaveAttemptIdSchema.parse("attempt"), mode: "save" as const, userId: "saving-user" };
const laterRequest = { ...request, saveAttemptId: SaveAttemptIdSchema.parse("later-attempt") };

describe("initSelectContentWork", () => {
	it("uploads the selected bytes, commits its pointer and readiness together, records its author and original extraction time, then reports completion", async () => {
		const winner = source();
		const imageSource = source("tier-0");
		imageSource.metadata.imageUrl = "https://cdn.example.com/thumbnail.png";
		const { work, deps, commit, events } = setup({ listAvailableTierSources: async () => [winner, imageSource] });
		const extractedAt = "2026-10-04T23:58:00.000Z";

		await work({ ...request, extractedAt, candidates: [{ id: cid("tier-1"), tier: "tier-1" }] });

		expect(events).toEqual(["upload", "commit", "version", "completion"]);
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: URL, source: winner });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, {
			url: URL, canonicalCommit: commit,
			input: {
				tier: "tier-1", metadata: { ...winner.metadata, imageUrl: imageSource.metadata.imageUrl }, estimatedReadTime: 3,
				contentFetchedAt: NOW, now: NOW, canonicalChanged: true, canonicalContentHash: computeCanonicalContentHash(winner.html), userId: "saving-user",
			},
		});
		expect(deps.recordCrawlVersion).toHaveBeenCalledWith({ url: URL, crawledAt: extractedAt, authorUserId: "original-author", canonicalCommit: commit });
	});

	it("records a changed body at the current time when an extraction timestamp is absent", async () => {
		const { work, deps } = setup();
		await work(request);
		expect(deps.recordCrawlVersion).toHaveBeenCalledWith(expect.objectContaining({ crawledAt: NOW }));
	});

	it("refreshes committed provenance without duplicating an identical-body crawl version", async () => {
		const { work, deps, events } = setup({ loadArticle: async () => article({
			freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(source().html) },
			contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 2 },
		}) });
		await work(laterRequest);
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, expect.objectContaining({ input: expect.objectContaining({ canonicalChanged: false }) }));
		expect(events).toEqual(["upload", "commit", "completion"]);
	});

	it("records the capture's author when a different tier with the same readable text replaces the canonical", async () => {
		const { work, deps } = setup({
			loadArticle: async () => article({
				freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(source().html) },
				contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 2 },
			}),
			listAvailableTierSources: async () => [source(), source("tier-0")],
			selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("tier-0"), reason: "Carries the images" }),
		});
		await work(request);
		expect(deps.recordCrawlVersion).toHaveBeenCalledWith(expect.objectContaining({ authorUserId: "original-author" }));
	});

	it("records a version when a fresh capture in the canonical's own tier carries different readable text", async () => {
		const html = "<p>Complete article with a new closing paragraph</p>";
		const fresh: VerifiedTierSource = { tier: "tier-1", html, metadata: { ...candidateProvenance({
			metadata, html, evaluationHtml: html, attemptId: request.saveAttemptId, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW,
		}), id: cid("fresh") } };
		const { work, deps } = setup({
			loadArticle: async () => article({
				freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(source().html) },
				contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 2 },
			}),
			listAvailableTierSources: async () => [source(), fresh],
			selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("fresh"), reason: "Longer" }),
		});
		await work(request);
		expect(deps.recordCrawlVersion).toHaveBeenCalledTimes(1);
	});

	it("promotes a recrawl through its recrawl transition and carries the immutable commit", async () => {
		const { work, deps, commit } = setup();
		await work({ ...request, mode: "recrawl" });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, expect.objectContaining({
			canonicalCommit: commit, input: expect.objectContaining({ winnerTier: "tier-1", canonicalContentHash: computeCanonicalContentHash(source().html) }),
		}));
	});

	it("uses the refresh transition with the supplied freshness validators", async () => {
		const { work, deps, commit } = setup();
		const freshness = { etag: "etag", lastModified: "yesterday", bodyHash: "raw-body-hash", contentFetchedAt: NOW };
		await work({ ...request, mode: "refresh", refresh: freshness });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(refreshContent, expect.objectContaining({ canonicalCommit: commit, input: expect.objectContaining({ freshness }) }));
	});

	it("keeps the stored canonical through the recrawl tie transition when the judge ties it with a fresh identical copy", async () => {
		const existing = article({ contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps, commit } = setup({
			loadArticle: async () => existing, listAvailableTierSources: async () => [source(), source("tier-0")],
			selectMostCompleteContent: async () => ({ kind: "tie", candidateIds: [cid("tier-1"), cid("tier-0")], reason: "Identical prose" }),
		});
		await work({ ...laterRequest, mode: "recrawl", candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlTieKeptCanonical, { url: URL, input: { now: NOW }, canonicalCommit: { ...commit, expected: existing.contentSelection } });
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
	});

	it.each(["save", "recrawl"] as const)("retains the verified canonical and its existing version when the %s comparison returns none", async (mode) => {
		const existing = article({ contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps, events, commit } = setup({ loadArticle: async () => existing, selectMostCompleteContent: async () => ({ kind: "none", reason: "Blocked responses" }) });
		await work({ ...laterRequest, mode });
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(mode === "recrawl" ? recrawlTieKeptCanonical : promoteTier, expect.objectContaining({ canonicalCommit: { ...commit, expected: existing.contentSelection } }));
		expect(events).toEqual(["upload", "commit", "completion"]);
	});

	it("promotes this save's readable 200 live body instead of marking the article unreadable when the judge provider rejects the request", async () => {
		const live = source();
		live.metadata.httpStatus = 200;
		const { deps } = setup({ listAvailableTierSources: async () => [live] });
		const rejectingJudge = initSelectMostCompleteContent({ createChatCompletion: async () => { throw Object.assign(new Error("bad request"), { status: 400 }); }, logger: noopLogger }).selectMostCompleteContent;
		await initSelectContentWork({ ...deps, selectMostCompleteContent: rejectingJudge })({ ...request, candidates: [{ id: cid("tier-1"), tier: "tier-1" }] });
		expect(deps.transitionAndPersist).not.toHaveBeenCalledWith(markNoReadableArticle, expect.anything());
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, expect.objectContaining({ input: expect.objectContaining({ tier: "tier-1" }) }));
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: URL, source: live });
	});

	it("marks a first save with no readable content as failed under the same observed revision, without writing reader bytes", async () => {
		const expected = { revision: 2 };
		const { work, deps, events } = setup({ loadArticle: async () => article({ contentSelection: expected }), selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, { url: URL, input: { reason: { kind: "parse-error", detail: "no readable article candidate: CAPTCHA" } }, selectionExpected: { snapshot: expected } });
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(events).toEqual(["commit", "completion"]);
	});

	it.each([
		{ httpStatus: 403, reason: { kind: "blocked", cause: "edge-block" } },
		{ httpStatus: 429, reason: { kind: "blocked", cause: "rate-limited" } },
		{ httpStatus: 404, reason: { kind: "not-found", httpStatus: 404 } },
		{ httpStatus: 500, reason: { kind: "parse-error", detail: "no readable article candidate: Error page" } },
	])("records why this save's live response with HTTP $httpStatus had nothing readable", async ({ httpStatus, reason }) => {
		const refused = source();
		refused.metadata.httpStatus = httpStatus;
		const { work, deps } = setup({ listAvailableTierSources: async () => [refused], selectMostCompleteContent: async () => ({ kind: "none", reason: "Error page" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, { url: URL, input: { reason }, selectionExpected: { snapshot: undefined } });
	});

	it("does not blame an earlier attempt's refused live response for this save finding nothing readable", async () => {
		const earlier = source();
		earlier.metadata.httpStatus = 403;
		const { work, deps } = setup({ listAvailableTierSources: async () => [earlier], selectMostCompleteContent: async () => ({ kind: "none", reason: "Error page" }) });
		await work(laterRequest);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "parse-error", detail: "no readable article candidate: Error page" } } }));
	});

	it("records why this save's live crawl failed when it stored no live response and nothing else is readable", async () => {
		const { work, deps } = setup({ listAvailableTierSources: async () => [], selectMostCompleteContent: async () => ({ kind: "none", reason: "No candidates" }) });
		await work({ ...request, liveAttempt: { outcome: "no-body", failureReason: { kind: "origin-unreachable", code: "ENOTFOUND" } } });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "origin-unreachable", code: "ENOTFOUND" } } }));
	});

	it("leaves the row for the deferred comprehensive crawl when nothing readable has arrived yet", async () => {
		const { work, deps, events } = setup({ selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }) });
		await work({ ...request, liveAttempt: { outcome: "deferred" } });
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(events).toEqual(["completion"]);
	});

	it("leaves a readable legacy capture untouched when a co-saver's unreadable capture replaced its tier-0 pointer", async () => {
		const legacy = "<p>The first author's capture stored before candidates existed.</p>";
		const { work, deps, events } = setup({
			loadArticle: async () => article({ contentSelection: { tier: "tier-0" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy) } }),
			listAvailableTierSources: async () => [source("tier-0")], readCanonicalContent: async () => ({ content: legacy }),
			selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }),
		});
		await work({ ...request, candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(events).toEqual(["completion"]);
	});

	it("does not claim success or record a version when an upload fails", async () => {
		const { work, deps, events } = setup({ writeCanonicalContent: async () => { throw new Error("upload failed"); } });
		await expect(work(request)).rejects.toThrow("upload failed");
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(events).toEqual([]);
	});

	it("does not publish completion or a version when a stale selector loses the atomic commit", async () => {
		const { work, deps, events } = setup({ transitionAndPersist: async () => { throw new Error("selection changed"); } });
		await expect(work(request)).rejects.toThrow("selection changed");
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(events).toEqual(["upload"]);
	});

	it("records the selected version exactly once when the save is redelivered after its canonical commit landed but the attempt then failed", async () => {
		let stored = article();
		let commits = 0;
		const { work, deps } = setup({
			loadArticle: async () => stored,
			transitionAndPersist: jest.fn(async () => {
				commits += 1;
				stored = article({
					freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(source().html) },
					contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: commits },
				});
				if (commits === 1) throw new Error("effect dispatch failed");
			}),
		});
		await expect(work(request)).rejects.toThrow("effect dispatch failed");
		await work(request);
		expect(deps.recordCrawlVersion).toHaveBeenCalledTimes(1);
	});

	it("does not log a no-readable outcome if its conditional failure transition loses to a newer selection", async () => {
		const { work, events } = setup({ selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }), transitionAndPersist: async () => { throw new Error("selection changed"); } });
		await expect(work(request)).rejects.toThrow("selection changed");
		expect(events).toEqual([]);
	});
});
