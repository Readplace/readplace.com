import assert from "node:assert/strict";
import { SaveAttemptIdSchema, CandidateIdSchema, type SaveAttemptId } from "@packages/domain/article";
import { initSelectMostCompleteContent, type ContentDecision, type SelectMostCompleteContent } from "./select-content";
import { noopLogger } from "@packages/logger";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { type Article, type CanonicalCommit, type Effect, type TransitionAndPersist, initTransitionAndPersist, requestRecrawl, promoteTier, recrawlPromoteTier, recrawlTieKeptCanonical, refreshContent } from "@packages/domain/article-aggregate";
import { initSelectContentWork, type SelectContentDependencies } from "./select-content-work";
import { candidateProvenance, type PutTierSource, type VerifiedTierSource } from "@packages/tier-source";
import { labelForIndex } from "./select-content-prompt";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";
import { markNoReadableArticle } from "./mark-no-readable-article";
import { COMPARISON_COMPLETED } from "./comparison-log";

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
function judgedSource(): VerifiedTierSource {
	const judged = source();
	judged.metadata.wordCount = 99;
	return judged;
}
function article(overrides: Partial<Article> = {}): Article {
	return { url: URL, metadata, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 3,
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Summary" }, summaryAutoHeal: { attempts: 0 }, ...overrides };
}
function judgeReply(decision: ContentDecision, candidates: Parameters<SelectMostCompleteContent>[0]["candidates"]): string {
	const label = (id: string) => labelForIndex(candidates.findIndex((candidate) => candidate.id === id));
	const answer = decision.kind === "winner" ? { kind: decision.kind, candidate: label(decision.candidateId), reason: decision.reason }
		: decision.kind === "tie" ? { kind: decision.kind, candidates: decision.candidateIds.map(label), reason: decision.reason }
		: decision;
	return JSON.stringify({ ...answer, readability: candidates.map((candidate) => ({ candidate: label(candidate.id), readable: decision.kind === "winner" ? candidate.id === decision.candidateId : decision.kind === "tie" && decision.candidateIds.includes(candidate.id) })) });
}
type TestDependencies = Omit<SelectContentDependencies, "selectMostCompleteContent"> & {
	selectMostCompleteContent: (params: Parameters<SelectMostCompleteContent>[0]) => Promise<ContentDecision>;
};
function setup(overrides: Partial<TestDependencies> = {}) {
	const stored: Omit<CanonicalCommit, "expected" | "originalUrl"> = {
		contentLocation: "s3://bucket/immutable/content.html", candidateId: cid("tier-1"),
		tier: "tier-1",
	};
	const commit: CanonicalCommit = { ...stored, originalUrl: URL, expected: undefined };
	const events: string[] = [];
	const transitionAndPersist: TransitionAndPersist = jest.fn(async () => { events.push("commit"); });
	const deps: TestDependencies = {
		listAvailableTierSources: async () => [source()],
		selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("tier-1"), reason: "Most complete" }),
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => new Date(NOW) }), logger: noopLogger, now: () => new Date(NOW) }),
		writeCanonicalContent: jest.fn(async () => { events.push("upload"); return stored; }),
		recordCrawlVersion: jest.fn(async () => { events.push("version"); }),
		readCanonicalContent: async () => undefined, loadArticle: async () => article(), transitionAndPersist,
		resolveOriginalUrl: async () => URL,
		verifyWrapperSource: async () => ({ originalUrl: URL, sourceUrl: "https://archive.ph/abc12" }),
		fetchRedditPostCard: async () => undefined,
		fetchYouTubeVideoCard: jest.fn(async () => undefined),
		putTierSource: jest.fn(async (params: Parameters<PutTierSource>[0]) => ({ ...params.metadata, htmlLocation: "s3://bucket/card.html", evaluationLocation: "s3://bucket/card-evaluation.html" })),
		now: () => new Date(NOW), logger: { ...noopLogger, info: jest.fn(() => { events.push("completion"); }) },
		...overrides,
	};
	const selectMostCompleteContent: SelectMostCompleteContent = async (params) => {
		const decision = await deps.selectMostCompleteContent(params);
		return initSelectMostCompleteContent({ createChatCompletion: async () => ({ choices: [{ message: { content: judgeReply(decision, params.candidates) } }] }), logger: noopLogger, deepseekCallFailedLog: noopLogger }).selectMostCompleteContent(params);
	};
	const work = initSelectContentWork({ ...deps, selectMostCompleteContent });
	return { work: (params: WithoutBudget<Parameters<typeof work>[0]>) => work({ ...params, remainingTimeMs: () => LAMBDA_BUDGET_MS }), deps, commit, events };
}
const LAMBDA_BUDGET_MS = 300_000;
type WithoutBudget<Request> = Request extends unknown ? Omit<Request, "remainingTimeMs"> : never;
const request = { url: URL, saveAttemptId: SaveAttemptIdSchema.parse("attempt"), claimId: "message-1", mode: "save" as const };
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
				tier: "tier-1", display: { kind: "candidate" }, metadata: { ...winner.metadata, imageUrl: imageSource.metadata.imageUrl }, estimatedReadTime: 3,
				contentFetchedAt: NOW, now: NOW, canonicalChanged: true, canonicalContentHash: computeCanonicalContentHash(winner.html),
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


	it("recovers the failed saved GitHub PDF row through recrawl selection without creating a raw-URL article", async () => {
		const blobUrl = "https://github.com/sample/docs/blob/main/guides/paper.pdf";
		const rawUrl = "https://github.com/sample/docs/raw/refs/heads/main/guides/paper.pdf";
		const html = "<p>The complete extracted PDF handbook.</p>";
		const winner: VerifiedTierSource = { tier: "tier-1", html, metadata: { ...candidateProvenance({
			metadata: { ...metadata, title: "Research handbook" }, html, evaluationHtml: html,
			attemptId: request.saveAttemptId, originalUrl: blobUrl, sourceUrl: rawUrl, kind: "live", fetchedAt: NOW,
		}), id: cid("github-pdf") } };
		const rows = new Map<string, Article>([[blobUrl, article({
			url: blobUrl, metadata: { ...metadata, wordCount: 0 }, freshness: { contentFetchedAt: NOW },
			crawl: { kind: "failed", reason: { kind: "parse-error", detail: "No readable viewer content" } },
			summary: { kind: "skipped", reason: "crawl-failed" },
		})]]);
		const bodies = new Map<string, string>();
		const { transitionAndPersist } = initTransitionAndPersist({
			store: { load: async (url) => rows.get(url), save: async ({ article: next }) => { rows.set(next.url, next); } },
			dispatchEffect: async () => {},
			logCrawlSettled: () => {},
		});
		await transitionAndPersist(requestRecrawl, { url: blobUrl, input: { now: NOW } });
		const { work } = setup({
			loadArticle: async (url) => rows.get(url), resolveOriginalUrl: async (url) => url,
			listAvailableTierSources: async () => [winner], transitionAndPersist,
			selectMostCompleteContent: async () => ({ kind: "winner", candidateId: winner.metadata.id, reason: "Readable PDF" }),
			writeCanonicalContent: async ({ url, source }) => {
				bodies.set(url, source.html);
				return { contentLocation: "s3://bucket/immutable/pdf.html", candidateId: source.metadata.id, tier: source.tier };
			},
		});

		await work({ ...request, url: blobUrl, mode: "recrawl", candidates: [{ id: winner.metadata.id, tier: "tier-1" }] });

		expect([...rows.keys()]).toEqual([blobUrl]);
		expect(rows.get(blobUrl)?.crawl).toEqual({ kind: "ready" });
		expect(rows.get(blobUrl)?.metadata.title).toBe("Research handbook");
		expect(rows.get(blobUrl)?.freshness.canonicalContentHash).toBe(computeCanonicalContentHash(html));
		expect([...bodies]).toEqual([[blobUrl, html]]);
	});

	it("promotes a recrawl through its recrawl transition and carries the immutable commit", async () => {
		const { work, deps, commit } = setup();
		await work({ ...request, mode: "recrawl", candidates: [] });
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

	it("advances a refresh's freshness without asking the judge when the fresh copy's prose matches the canonical", async () => {
		const selectMostCompleteContent = jest.fn<ReturnType<TestDependencies["selectMostCompleteContent"]>, Parameters<TestDependencies["selectMostCompleteContent"]>>();
		const { work, deps } = setup({
			loadArticle: async () => article({ freshness: { contentFetchedAt: "2026-10-04T00:00:00.000Z", canonicalContentHash: computeCanonicalContentHash(source().html) }, contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 3 } }),
			listAvailableTierSources: async () => [source(), source("tier-0")],
			selectMostCompleteContent,
		});
		const freshness = { etag: "etag", bodyHash: "raw-body-hash", contentFetchedAt: NOW };

		await work({ ...laterRequest, mode: "refresh", refresh: freshness, candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });

		expect(selectMostCompleteContent).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(refreshContent, expect.objectContaining({ input: expect.objectContaining({ freshness }) }));
	});

	it("publishes canonical-content-changed when a refresh commits a body with a new hash, so highlights re-anchor as on a recrawl", async () => {
		const rows = new Map<string, Article>([[URL, article({
			freshness: { contentFetchedAt: "2026-10-04T00:00:00.000Z", canonicalContentHash: "previous-hash" },
			contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 3 },
		})]]);
		const dispatched: unknown[] = [];
		const { transitionAndPersist } = initTransitionAndPersist({
			store: { load: async (url) => rows.get(url), save: async ({ article: next }) => { rows.set(next.url, next); } },
			dispatchEffect: async (effect) => { dispatched.push(effect); },
			logCrawlSettled: () => {},
		});
		const { work } = setup({ loadArticle: async (url) => rows.get(url), transitionAndPersist });

		await work({ ...laterRequest, mode: "refresh", refresh: { bodyHash: "raw-body-hash", contentFetchedAt: NOW }, candidates: [{ id: cid("tier-1"), tier: "tier-1" }] });

		expect(rows.get(URL)?.freshness.canonicalContentHash).toBe(computeCanonicalContentHash(source().html));
		expect(dispatched).toContainEqual({ kind: "publish-canonical-content-changed", url: URL });
		expect(dispatched).not.toContainEqual({ kind: "generate-summary", url: URL });
	});

	it("keeps the stored canonical through the recrawl tie transition when the judge ties it with a fresh identical copy", async () => {
		const existing = article({ contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps, commit } = setup({
			loadArticle: async () => existing, listAvailableTierSources: async () => [source(), source("tier-0")],
			selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("tier-1"), reason: "Identical prose" }),
		});
		await work({ ...laterRequest, mode: "recrawl", candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlTieKeptCanonical, { url: URL, input: { now: NOW, publishedOn: undefined, display: { kind: "row" } }, canonicalCommit: { ...commit, expected: existing.contentSelection } });
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
	});

	it("promotes a save with the winner's publish date", async () => {
		const winner = source();
		winner.metadata.publishedOn = "2025-10-08";
		const other = source("tier-0");
		other.metadata.publishedOn = "2024-01-01";
		const { work, deps } = setup({ listAvailableTierSources: async () => [winner, other] });

		await work(request);

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, expect.objectContaining({
			input: expect.objectContaining({ metadata: expect.objectContaining({ publishedOn: "2025-10-08" }) }),
		}));
	});

	it("writes the fresh candidate's publish date when a refresh retains the canonical, whose manifest has none", async () => {
		const fresh = source("tier-0");
		fresh.metadata.publishedOn = "2025-10-08";
		const { work, deps } = setup({
			loadArticle: async () => article({ freshness: { contentFetchedAt: "2026-10-04T00:00:00.000Z", canonicalContentHash: computeCanonicalContentHash(source().html) }, contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 3 } }),
			listAvailableTierSources: async () => [source(), fresh],
		});

		await work({ ...laterRequest, mode: "refresh", refresh: { bodyHash: "raw-body-hash", contentFetchedAt: NOW }, candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(refreshContent, expect.objectContaining({
			input: expect.objectContaining({ metadata: expect.objectContaining({ publishedOn: "2025-10-08" }) }),
		}));
	});

	it("passes the resolved publish date into the recrawl tie transition", async () => {
		const fresh = source("tier-0");
		fresh.metadata.publishedOn = "2025-10-08";
		const existing = article({ contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps } = setup({
			loadArticle: async () => existing, listAvailableTierSources: async () => [source(), fresh],
			selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("tier-1"), reason: "Identical prose" }),
		});

		await work({ ...laterRequest, mode: "recrawl", candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlTieKeptCanonical, expect.objectContaining({
			input: { now: NOW, publishedOn: "2025-10-08", display: { kind: "row" } },
		}));
	});

	it("commits the identity selection resolved for the row, not the winner's recorded one", async () => {
		const archive = "https://archive.ph/abc12";
		const capture = source("tier-0");
		capture.metadata.originalUrl = archive;
		capture.metadata.sourceUrl = archive;
		const { work, deps } = setup({
			loadArticle: async () => article({
				url: archive,
				contentSelection: { candidateId: cid("tier-0"), tier: "tier-0", revision: 4 },
				freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(capture.html) },
			}),
			listAvailableTierSources: async () => [capture],
			selectMostCompleteContent: async () => ({ kind: "winner", candidateId: cid("tier-0"), reason: "The snapshot" }),
		});
		await work({ ...laterRequest, url: archive, mode: "recrawl", candidates: [] });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlTieKeptCanonical, expect.objectContaining({ canonicalCommit: expect.objectContaining({ originalUrl: URL }) }));
	});

	it.each(["save", "recrawl"] as const)("retains the verified canonical and its existing version when the %s comparison returns none", async (mode) => {
		const existing = article({ contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps, events, commit } = setup({ loadArticle: async () => existing, selectMostCompleteContent: async () => ({ kind: "none", reason: "Blocked responses" }) });
		await work(mode === "recrawl" ? { ...laterRequest, mode, candidates: [] } : { ...laterRequest, mode });
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(mode === "recrawl" ? recrawlTieKeptCanonical : promoteTier, expect.objectContaining({ canonicalCommit: { ...commit, expected: existing.contentSelection } }));
		expect(events).toEqual(["upload", "commit", "completion"]);
	});

	it("promotes this save's readable 200 live body instead of marking the article unreadable when the judge provider rejects the request", async () => {
		const live = judgedSource();
		live.metadata.httpStatus = 200;
		const { deps } = setup({ listAvailableTierSources: async () => [live] });
		const rejectingJudge = initSelectMostCompleteContent({ createChatCompletion: async () => { throw Object.assign(new Error("bad request"), { status: 400 }); }, logger: noopLogger, deepseekCallFailedLog: noopLogger }).selectMostCompleteContent;
		await initSelectContentWork({ ...deps, selectMostCompleteContent: rejectingJudge })({ ...request, candidates: [{ id: cid("tier-1"), tier: "tier-1" }], remainingTimeMs: () => LAMBDA_BUDGET_MS });
		expect(deps.transitionAndPersist).not.toHaveBeenCalledWith(markNoReadableArticle, expect.anything());
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, expect.objectContaining({ input: expect.objectContaining({ tier: "tier-1" }) }));
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: URL, source: live });
	});

	it("marks a first save with no readable content as failed under the same observed revision, without writing reader bytes", async () => {
		const expected = { revision: 2 };
		const { work, deps, events } = setup({ loadArticle: async () => article({ contentSelection: expected }), listAvailableTierSources: async () => [judgedSource()], selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, { url: URL, input: { reason: { kind: "parse-error", detail: "no readable article candidate: CAPTCHA" } }, selectionExpected: { snapshot: expected } });
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(deps.recordCrawlVersion).not.toHaveBeenCalled();
		expect(events).toEqual(["commit", "completion"]);
	});

	it("promotes the reader's capture instead of failing the save when the judge finds neither it nor this save's 404 page readable", async () => {
		const capture = source("tier-0");
		const notFound = source();
		notFound.metadata.httpStatus = 404;
		const { work, deps, events } = setup({ listAvailableTierSources: async () => [capture, notFound], selectMostCompleteContent: async () => ({ kind: "none", reason: "Both are error pages" }) });
		await work({ ...request, candidates: [{ id: cid("tier-0"), tier: "tier-0" }, { id: cid("tier-1"), tier: "tier-1" }] });
		expect(deps.transitionAndPersist).not.toHaveBeenCalledWith(markNoReadableArticle, expect.anything());
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: URL, source: capture });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, expect.objectContaining({ input: expect.objectContaining({ tier: "tier-0" }) }));
		expect(deps.recordCrawlVersion).toHaveBeenCalledTimes(1);
		expect(events).toEqual(["upload", "commit", "version", "completion"]);
	});

	it.each([
		{ httpStatus: 403, reason: { kind: "blocked", cause: "edge-block" } },
		{ httpStatus: 419, reason: { kind: "blocked", cause: "edge-block" } },
		{ httpStatus: 429, reason: { kind: "blocked", cause: "rate-limited" } },
		{ httpStatus: 404, reason: { kind: "not-found", httpStatus: 404 } },
		{ httpStatus: 500, reason: { kind: "parse-error", detail: "no readable article candidate: the only candidate answered HTTP 500" } },
	])("records why this save's live response with HTTP $httpStatus had nothing readable", async ({ httpStatus, reason }) => {
		const refused = source();
		refused.metadata.httpStatus = httpStatus;
		const { work, deps } = setup({ listAvailableTierSources: async () => [refused], selectMostCompleteContent: async () => ({ kind: "none", reason: "Error page" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, { url: URL, input: { reason }, selectionExpected: { snapshot: undefined } });
	});

	it.each([
		{ renderedThrough: "direct-egress" as const },
		{ renderedThrough: "residential-proxy" as const },
		{ renderedThrough: "residential-per-gb" as const },
		{ renderedThrough: "web-unlocker-fetch" as const },
		{ renderedThrough: "web-unlocker-render" as const },
	])("records that this save's live page had nothing readable even after rendering it through $renderedThrough", async ({ renderedThrough }) => {
		const rendered = judgedSource();
		rendered.metadata.httpStatus = 200;
		rendered.metadata.renderedThrough = renderedThrough;
		const { work, deps } = setup({ listAvailableTierSources: async () => [rendered], selectMostCompleteContent: async () => ({ kind: "none", reason: "App shell" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "parse-error", detail: `no readable article candidate after render (${renderedThrough}): App shell` } } }));
	});

	it("does not say an earlier attempt's rendered page was rendered for this save", async () => {
		const earlier = judgedSource();
		earlier.metadata.renderedThrough = "direct-egress";
		const { work, deps } = setup({ listAvailableTierSources: async () => [earlier], selectMostCompleteContent: async () => ({ kind: "none", reason: "App shell" }) });
		await work(laterRequest);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "parse-error", detail: "no readable article candidate: App shell" } } }));
	});

	it("does not blame an earlier attempt's refused live response for this save finding nothing readable", async () => {
		const earlier = source();
		earlier.metadata.httpStatus = 403;
		const { work, deps } = setup({ listAvailableTierSources: async () => [earlier], selectMostCompleteContent: async () => ({ kind: "none", reason: "Error page" }) });
		await work(laterRequest);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "parse-error", detail: "no readable article candidate: the only candidate answered HTTP 403" } } }));
	});

	it.each([
		{ liveStatus: 200, label: "a readable-looking live page" },
		{ liveStatus: 403, label: "a refused live response" },
	])("records this save's own unreadable capture as the reason nothing was readable, ahead of $label", async ({ liveStatus }) => {
		const capture = source("tier-0");
		capture.metadata.wordCount = 0;
		const live = source();
		live.metadata.httpStatus = liveStatus;
		const { work, deps } = setup({ listAvailableTierSources: async () => [capture, live], selectMostCompleteContent: async () => ({ kind: "none", reason: "Nothing readable" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "capture-unreadable", detail: "no readable article candidate: Nothing readable" } } }));
	});

	it("lets a refused live response explain an automatic capture that nothing could read", async () => {
		const capture = source("tier-0");
		capture.metadata.captureTrigger = "automatic";
		const live = source();
		live.metadata.httpStatus = 404;
		const { work, deps } = setup({ listAvailableTierSources: async () => [capture, live], selectMostCompleteContent: async () => ({ kind: "none", reason: "Nothing readable" }) });
		await work(request);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "not-found", httpStatus: 404 } } }));
	});

	it("does not call a capture from an earlier attempt this save's capture when nothing is readable", async () => {
		const { work, deps } = setup({ listAvailableTierSources: async () => [source("tier-0"), source()], selectMostCompleteContent: async () => ({ kind: "none", reason: "Nothing readable" }) });
		await work(laterRequest);
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "parse-error", detail: "no readable article candidate: Nothing readable" } } }));
	});

	it("records why this save's live crawl failed when it stored no live response and nothing else is readable", async () => {
		const { work, deps } = setup({ listAvailableTierSources: async () => [], selectMostCompleteContent: async () => ({ kind: "none", reason: "No candidates" }) });
		await work({ ...request, liveAttempt: { outcome: "no-body", failureReason: { kind: "origin-unreachable", code: "ENOTFOUND" } } });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "origin-unreachable", code: "ENOTFOUND" } } }));
	});

	it("keeps the exhausted-retries reason when a dead-lettered deferred crawl selects over an unreadable stored capture", async () => {
		const { work, deps } = setup({ listAvailableTierSources: async () => [source("tier-2")], selectMostCompleteContent: async () => ({ kind: "none", reason: "Nothing readable" }) });
		await work({ ...request, liveAttempt: { outcome: "no-body", failureReason: { kind: "exhausted-retries", receiveCount: 1 } } });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, expect.objectContaining({ input: { reason: { kind: "exhausted-retries", receiveCount: 1 } } }));
	});

	it("leaves the row for the deferred comprehensive crawl when nothing readable has arrived yet", async () => {
		const { work, deps, events } = setup({ listAvailableTierSources: async () => [judgedSource()], selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }) });
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
		const { work, events } = setup({ listAvailableTierSources: async () => [judgedSource()], selectMostCompleteContent: async () => ({ kind: "none", reason: "CAPTCHA" }), transitionAndPersist: async () => { throw new Error("selection changed"); } });
		await expect(work(request)).rejects.toThrow("selection changed");
		expect(events).toEqual([]);
	});

	describe("the title a selection that kept the stored canonical shows", () => {
		const PROSE = "<p>Complete article</p>";
		const STALE = { title: "Article from link.mail.example", siteName: "link.mail.example", excerpt: "Content saved from link.mail.example." };
		const FILING = { title: "Anthropic, PBC - S-1/A-1", siteName: "www.sec.gov", excerpt: "Filing excerpt" };
		function candidate(params: { id: string; tier: VerifiedTierSource["tier"]; shown: typeof STALE; html?: string; sourceUrl?: string; httpStatus?: number }): VerifiedTierSource {
			const html = params.html ?? PROSE;
			const provenance = candidateProvenance({
				metadata: { ...metadata, ...params.shown }, html, evaluationHtml: html, attemptId: laterRequest.saveAttemptId, originalUrl: URL,
				sourceUrl: params.sourceUrl ?? URL, kind: params.tier === "tier-0" ? "extension" : "live", fetchedAt: NOW,
			});
			return { tier: params.tier, html, metadata: { ...provenance, id: cid(params.id), httpStatus: params.httpStatus } };
		}
		async function shownAfter(params: {
			stored: VerifiedTierSource;
			row?: typeof STALE;
			sources: VerifiedTierSource[];
			fresh: string[];
			mode?: "save" | "recrawl" | "refresh";
			judge?: TestDependencies["selectMostCompleteContent"];
		}) {
			const rows = new Map<string, Article>([[URL, article({
				metadata: { ...metadata, ...(params.row ?? STALE) },
				freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(params.stored.html) },
				contentSelection: { candidateId: params.stored.metadata.id, tier: params.stored.tier, revision: 4 },
			})]]);
			const { transitionAndPersist } = initTransitionAndPersist({
				store: { load: async (url) => rows.get(url), save: async ({ article: next }) => { rows.set(next.url, next); } },
				dispatchEffect: async () => {},
				logCrawlSettled: () => {},
			});
			const { work } = setup({
				loadArticle: async (url) => rows.get(url), transitionAndPersist,
				listAvailableTierSources: async () => [params.stored, ...params.sources],
				selectMostCompleteContent: params.judge,
				writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://bucket/immutable/content.html", candidateId: source.metadata.id, tier: source.tier }),
			});
			const all = [params.stored, ...params.sources];
			const candidates = params.fresh.map((id) => {
				const found = all.find((source) => source.metadata.id === id);
				assert(found, `no source ${id}`);
				return { id: found.metadata.id, tier: found.tier };
			});
			const mode = params.mode ?? "recrawl";
			await work(mode === "refresh" ? { ...laterRequest, mode, candidates, refresh: { bodyHash: "raw-body-hash", contentFetchedAt: NOW } } : { ...laterRequest, mode, candidates });
			const { title, siteName, excerpt } = rows.get(URL)?.metadata ?? {};
			return { title, siteName, excerpt };
		}

		it("takes the fresh tier-1 source's title, siteName and excerpt when a recrawl finds the prose unchanged", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: FILING })],
				fresh: ["fresh"],
			});
			assert.deepEqual(shown, FILING);
		});

		it("takes the fresh tier-1 source's title when a duplicate recrawl delivery carries the same prose in different markup", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: FILING, html: "<div><p>Complete article</p></div>" })],
				fresh: ["fresh"],
			});
			assert.deepEqual(shown, FILING);
		});

		it("keeps a repaired title when a later save finds the prose unchanged", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }), row: FILING,
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: STALE })],
				fresh: ["fresh"], mode: "save",
			});
			assert.deepEqual(shown, FILING);
		});

		it("keeps the row's title when a refresh's fresh tier-1 source finds the prose unchanged under another title", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: FILING })],
				fresh: ["fresh"], mode: "refresh",
			});
			assert.deepEqual(shown, STALE);
		});

		it("keeps the row's title when an unchanged save's only fresh source is a capture", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "capture", tier: "tier-0", shown: FILING })],
				fresh: ["capture"], mode: "save",
			});
			assert.deepEqual(shown, STALE);
		});

		it("keeps the row's title when a recrawl finds unchanged prose over a stored capture", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-0", shown: STALE }),
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: FILING })],
				fresh: ["fresh"],
			});
			assert.deepEqual(shown, STALE);
		});

		it("keeps the row's title when the judge keeps the stored tier-1 canonical over a different fresh copy", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: FILING, html: "<p>A shorter teaser</p>" })],
				fresh: ["fresh"],
				judge: async () => ({ kind: "winner", candidateId: cid("stored"), reason: "More complete" }),
			});
			assert.deepEqual(shown, STALE);
		});

		it("keeps the row's title when the judge rejects every candidate beside a fresh 403 page", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "blocked", tier: "tier-1", shown: FILING, html: "<p>Access denied</p>", httpStatus: 403 })],
				fresh: ["blocked"],
				judge: async () => ({ kind: "none", reason: "Blocked responses" }),
			});
			assert.deepEqual(shown, STALE);
		});

		it("keeps the row's title when the fresh tier-1 source was fetched through a wrapper link", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "fresh", tier: "tier-1", shown: FILING, sourceUrl: "https://javascriptweekly.com/link/123/web" })],
				fresh: ["fresh"],
			});
			assert.deepEqual(shown, STALE);
		});

		it("keeps the row's title when the only other tier-1 source came from an earlier event", async () => {
			const shown = await shownAfter({
				stored: candidate({ id: "stored", tier: "tier-1", shown: STALE }),
				sources: [candidate({ id: "earlier", tier: "tier-1", shown: FILING }), candidate({ id: "capture", tier: "tier-0", shown: FILING })],
				fresh: ["capture"],
			});
			assert.deepEqual(shown, STALE);
		});
	});
});

describe("the video card fallback", () => {
	const VIDEO_URL = "https://www.youtube.com/watch?v=I-jk9ni4XWk";
	const CARD = {
		title: "How to Live to be 100+", author: "TED", excerpt: "Video by TED on YouTube.", watchUrl: VIDEO_URL,
		posterUrl: "https://i.ytimg.com/vi/I-jk9ni4XWk/hqdefault.jpg",
		html: '<p class="reader-embed-facade"><a href="https://www.youtube.com/watch?v=I-jk9ni4XWk" target="_blank" rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/I-jk9ni4XWk/hqdefault.jpg" alt="Watch on YouTube" loading="lazy"></a></p>',
	};
	const videoRequest = { ...request, url: VIDEO_URL };
	function renderedShell(): VerifiedTierSource {
		const html = "<p>Before you continue to YouTube</p>";
		return { tier: "tier-1", html, metadata: { ...candidateProvenance({
			metadata: { ...metadata, wordCount: 5 }, html, evaluationHtml: html, attemptId: request.saveAttemptId, originalUrl: VIDEO_URL, sourceUrl: VIDEO_URL, kind: "live", fetchedAt: NOW,
		}), id: cid("rendered-shell") } };
	}
	function storedDescription(tier: VerifiedTierSource["tier"]): VerifiedTierSource {
		const html = "<p>A talk about the places where people live longest</p>";
		return { tier, html, metadata: { ...candidateProvenance({
			metadata, html, evaluationHtml: html, attemptId: request.saveAttemptId, originalUrl: VIDEO_URL, sourceUrl: VIDEO_URL, kind: tier === "tier-0" ? "extension" : "live", fetchedAt: NOW,
		}), id: cid(tier) } };
	}
	function setupVideo(overrides: Partial<TestDependencies> = {}) {
		return setup({
			loadArticle: async () => article({ url: VIDEO_URL }), resolveOriginalUrl: async () => VIDEO_URL,
			listAvailableTierSources: async () => [renderedShell()],
			selectMostCompleteContent: async () => ({ kind: "none", reason: "Empty shell" }),
			fetchRedditPostCard: async () => undefined,
		fetchYouTubeVideoCard: jest.fn(async () => CARD),
			...overrides,
		});
	}
	function comparisonLine(logger: TestDependencies["logger"]) {
		const line = jest.mocked(logger.info).mock.calls.map(([message]) => String(message)).find((message) => message.startsWith(COMPARISON_COMPLETED));
		return JSON.parse(String(line).slice(COMPARISON_COMPLETED.length));
	}

	it("commits the card as this attempt's live candidate when a first save finds nothing readable", async () => {
		const { work, deps, events } = setupVideo();

		await work(videoRequest);

		expect(deps.fetchYouTubeVideoCard).toHaveBeenCalledWith({ url: VIDEO_URL });
		expect(deps.putTierSource).toHaveBeenCalledWith({
			url: VIDEO_URL, tier: "tier-1", html: CARD.html, evaluationHtml: CARD.html,
			metadata: expect.objectContaining({ attemptId: request.saveAttemptId, originalUrl: VIDEO_URL, sourceUrl: VIDEO_URL, kind: "live", httpStatus: 200 }),
		});
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(promoteTier, expect.objectContaining({ input: expect.objectContaining({
			tier: "tier-1",
			estimatedReadTime: 1,
			metadata: expect.objectContaining({ title: CARD.title, siteName: "YouTube", excerpt: CARD.excerpt, wordCount: 0, imageUrl: CARD.posterUrl }),
		}) }));
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: VIDEO_URL, source: expect.objectContaining({ html: CARD.html, metadata: expect.objectContaining({ htmlLocation: "s3://bucket/card.html" }) }) });
		expect(deps.transitionAndPersist).not.toHaveBeenCalledWith(markNoReadableArticle, expect.anything());
		expect(events).toEqual(["upload", "commit", "version", "completion"]);
		const comparison = comparisonLine(deps.logger);
		expect(comparison).toMatchObject({ outcome: "selected", selectionRule: "video-card-fallback", reason: "no readable candidate (Empty shell); served the oEmbed video card" });
		expect(comparison.candidates.at(-1)).toMatchObject({ id: comparison.selectedCandidateId, kind: "live", httpStatus: 200, sourceUrl: VIDEO_URL, readable: true, fresh: true });
	});

	it("fails the save as it does today when no card comes back", async () => {
		const { work, deps, events } = setupVideo({ fetchRedditPostCard: async () => undefined,
		fetchYouTubeVideoCard: jest.fn(async () => undefined) });

		await work(videoRequest);

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, { url: VIDEO_URL, input: { reason: { kind: "parse-error", detail: "no readable article candidate: Empty shell" } }, selectionExpected: { snapshot: undefined } });
		expect(deps.putTierSource).not.toHaveBeenCalled();
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(comparisonLine(deps.logger)).toMatchObject({ outcome: "no-readable", selectionRule: "judge" });
		expect(events).toEqual(["commit", "completion"]);
	});

	it("waits for the deferred comprehensive crawl before asking for a card", async () => {
		const { work, deps, events } = setupVideo();

		await work({ ...videoRequest, liveAttempt: { outcome: "deferred" } });

		expect(deps.fetchYouTubeVideoCard).not.toHaveBeenCalled();
		expect(events).toEqual(["completion"]);
	});

	it("leaves a withheld legacy canonical alone without asking for a card", async () => {
		const legacy = "<p>The first author's capture stored before candidates existed.</p>";
		const { work, deps, events } = setupVideo({
			loadArticle: async () => article({ url: VIDEO_URL, contentSelection: { tier: "tier-0" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy) } }),
			listAvailableTierSources: async () => [source("tier-0")], readCanonicalContent: async () => ({ content: legacy }),
		});

		await work({ ...videoRequest, candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });

		expect(deps.fetchYouTubeVideoCard).not.toHaveBeenCalled();
		expect(events).toEqual(["completion"]);
	});

	it("keeps a stored description through a refresh whose fresh render is unreadable", async () => {
		const existing = article({ url: VIDEO_URL, contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps } = setupVideo({ loadArticle: async () => existing, listAvailableTierSources: async () => [storedDescription("tier-1"), renderedShell()] });
		const freshness = { bodyHash: "raw-body-hash", contentFetchedAt: NOW };

		await work({ ...videoRequest, mode: "refresh", refresh: freshness });

		expect(deps.fetchYouTubeVideoCard).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(refreshContent, expect.objectContaining({ input: expect.objectContaining({ freshness }) }));
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: VIDEO_URL, source: storedDescription("tier-1") });
	});

	it("repairs a legacy zero-word row through the refresh transition", async () => {
		const html = "<p></p>";
		const zeroWord: VerifiedTierSource = { tier: "tier-1", html, metadata: { ...candidateProvenance({
			metadata: { ...metadata, wordCount: 0 }, html, evaluationHtml: html, attemptId: request.saveAttemptId, originalUrl: VIDEO_URL, sourceUrl: VIDEO_URL, kind: "live", fetchedAt: NOW,
		}), id: cid("tier-1") } };
		const existing = article({ url: VIDEO_URL, contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 1 }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash("") } });
		const { work, deps } = setupVideo({ loadArticle: async () => existing, listAvailableTierSources: async () => [zeroWord] });
		const freshness = { bodyHash: "raw-body-hash", contentFetchedAt: NOW };

		await work({ ...videoRequest, mode: "refresh", refresh: freshness });

		expect(deps.fetchYouTubeVideoCard).toHaveBeenCalledWith({ url: VIDEO_URL });
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: VIDEO_URL, source: expect.objectContaining({ html: CARD.html }) });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(refreshContent, expect.objectContaining({ input: expect.objectContaining({ freshness, metadata: expect.objectContaining({ title: CARD.title, wordCount: 0 }) }) }));
		expect(deps.transitionAndPersist).not.toHaveBeenCalledWith(markNoReadableArticle, expect.anything());
	});

	it("promotes the card through the recrawl transition", async () => {
		const { work, deps } = setupVideo();

		await work({ ...videoRequest, mode: "recrawl", candidates: [] });

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, expect.objectContaining({ input: expect.objectContaining({ winnerTier: "tier-1", metadata: expect.objectContaining({ title: CARD.title }) }) }));
	});

	it("lets the reader's own capture win without asking for a card", async () => {
		const { work, deps } = setupVideo({ listAvailableTierSources: async () => [storedDescription("tier-0"), renderedShell()] });

		await work(videoRequest);

		expect(deps.fetchYouTubeVideoCard).not.toHaveBeenCalled();
		expect(comparisonLine(deps.logger)).toMatchObject({ selectionRule: "own-capture-over-verdict" });
	});

	it("verifies the stored card as the canonical of a later selection", async () => {
		const first = setupVideo();
		await first.work(videoRequest);
		const [{ tier, html, evaluationHtml, metadata: stored }] = jest.mocked(first.deps.putTierSource).mock.calls[0];

		const later = setupVideo({
			loadArticle: async () => article({ url: VIDEO_URL, contentSelection: { candidateId: stored.id, tier, revision: 1 } }),
			listAvailableTierSources: async () => [{ tier, html, evaluationHtml, metadata: stored }],
			fetchRedditPostCard: async () => undefined,
		fetchYouTubeVideoCard: jest.fn(async () => undefined),
		});
		await later.work({ ...videoRequest, saveAttemptId: laterRequest.saveAttemptId });

		expect(later.deps.writeCanonicalContent).toHaveBeenCalledWith({ url: VIDEO_URL, source: expect.objectContaining({ html: CARD.html }) });
		expect(comparisonLine(later.deps.logger)).toMatchObject({ outcome: "retained" });
	});
});

describe("the post card fallback", () => {
	const POST_URL = "https://www.reddit.com/r/example_sub/comments/abc123/a_post_title/";
	const CANONICAL_POST_URL = "https://www.reddit.com/r/example_sub/comments/abc123/";
	const CARD = {
		title: "A post title", author: "example_user", subreddit: "example_sub", excerpt: "example_user", wordCount: 3, postUrl: CANONICAL_POST_URL, posterUrl: undefined,
		html: '<p class="reader-embed-facade"><a href="https://www.reddit.com/r/example_sub/comments/abc123/" target="_blank" rel="noopener noreferrer">A post title</a></p>',
	};
	const postRequest = { ...request, url: POST_URL, mode: "recrawl" as const, candidates: [] };
	function challengePage(): VerifiedTierSource {
		const html = "<p>Please wait for verification</p>";
		return { tier: "tier-1", html, metadata: { ...candidateProvenance({
			metadata: { ...metadata, wordCount: 4 }, html, evaluationHtml: html, attemptId: request.saveAttemptId, originalUrl: POST_URL, sourceUrl: POST_URL, kind: "live", fetchedAt: NOW,
		}), id: cid("challenge-page") } };
	}
	function storedPost(tier: VerifiedTierSource["tier"]): VerifiedTierSource {
		const html = "<p>The body of the post the reader kept</p>";
		return { tier, html, metadata: { ...candidateProvenance({
			metadata, html, evaluationHtml: html, attemptId: request.saveAttemptId, originalUrl: POST_URL, sourceUrl: POST_URL, kind: tier === "tier-0" ? "extension" : "live", fetchedAt: NOW,
		}), id: cid(tier) } };
	}
	function setupPost(overrides: Partial<TestDependencies> = {}) {
		return setup({
			loadArticle: async () => article({ url: POST_URL }), resolveOriginalUrl: async () => POST_URL,
			listAvailableTierSources: async () => [challengePage()],
			selectMostCompleteContent: async () => ({ kind: "none", reason: "Challenge page" }),
			fetchRedditPostCard: jest.fn(async () => CARD),
			...overrides,
		});
	}
	function comparisonLine(logger: TestDependencies["logger"]) {
		const line = jest.mocked(logger.info).mock.calls.map(([message]) => String(message)).find((message) => message.startsWith(COMPARISON_COMPLETED));
		return JSON.parse(String(line).slice(COMPARISON_COMPLETED.length));
	}

	it("commits the card as this attempt's live candidate when a recrawl finds nothing readable", async () => {
		const { work, deps, events } = setupPost();

		await work(postRequest);

		expect(deps.fetchYouTubeVideoCard).toHaveBeenCalledWith({ url: POST_URL });
		expect(deps.fetchRedditPostCard).toHaveBeenCalledWith({ url: POST_URL });
		expect(deps.putTierSource).toHaveBeenCalledWith({
			url: POST_URL, tier: "tier-1", html: CARD.html, evaluationHtml: CARD.html,
			metadata: expect.objectContaining({ attemptId: request.saveAttemptId, originalUrl: POST_URL, sourceUrl: CANONICAL_POST_URL, kind: "live", httpStatus: 200 }),
		});
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, expect.objectContaining({ input: expect.objectContaining({
			winnerTier: "tier-1",
			estimatedReadTime: 1,
			metadata: expect.objectContaining({ title: CARD.title, siteName: "Reddit", excerpt: CARD.excerpt, wordCount: CARD.wordCount }),
		}) }));
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: POST_URL, source: expect.objectContaining({ html: CARD.html, metadata: expect.objectContaining({ htmlLocation: "s3://bucket/card.html" }) }) });
		expect(deps.transitionAndPersist).not.toHaveBeenCalledWith(markNoReadableArticle, expect.anything());
		expect(events).toEqual(["upload", "commit", "version", "completion"]);
		const comparison = comparisonLine(deps.logger);
		expect(comparison).toMatchObject({ outcome: "selected", selectionRule: "post-card-fallback", reason: "no readable candidate (Challenge page); served the oEmbed post card" });
		expect(comparison.candidates.at(-1)).toMatchObject({ id: comparison.selectedCandidateId, kind: "live", httpStatus: 200, sourceUrl: CANONICAL_POST_URL, readable: true, fresh: true });
	});

	it("fails the recrawl as it does today when no card comes back", async () => {
		const { work, deps, events } = setupPost({ fetchRedditPostCard: jest.fn(async () => undefined) });

		await work(postRequest);

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markNoReadableArticle, { url: POST_URL, input: { reason: { kind: "parse-error", detail: "no readable article candidate: Challenge page" } }, selectionExpected: { snapshot: undefined } });
		expect(deps.putTierSource).not.toHaveBeenCalled();
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(comparisonLine(deps.logger)).toMatchObject({ outcome: "no-readable", selectionRule: "judge" });
		expect(events).toEqual(["commit", "completion"]);
	});

	it("waits for the deferred comprehensive crawl before asking for a card", async () => {
		const { work, deps, events } = setupPost();

		await work({ ...postRequest, liveAttempt: { outcome: "deferred" } });

		expect(deps.fetchRedditPostCard).not.toHaveBeenCalled();
		expect(events).toEqual(["completion"]);
	});

	it("leaves a withheld legacy canonical alone without asking for a card", async () => {
		const legacy = "<p>The first author's capture stored before candidates existed.</p>";
		const { work, deps, events } = setupPost({
			loadArticle: async () => article({ url: POST_URL, contentSelection: { tier: "tier-0" }, freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(legacy) } }),
			listAvailableTierSources: async () => [source("tier-0")], readCanonicalContent: async () => ({ content: legacy }),
		});

		await work({ ...postRequest, candidates: [{ id: cid("tier-0"), tier: "tier-0" }] });

		expect(deps.fetchRedditPostCard).not.toHaveBeenCalled();
		expect(events).toEqual(["completion"]);
	});

	it("keeps a stored post through a refresh whose fresh fetch is unreadable", async () => {
		const existing = article({ url: POST_URL, contentSelection: { candidateId: cid("tier-1"), tier: "tier-1", revision: 4 } });
		const { work, deps } = setupPost({ loadArticle: async () => existing, listAvailableTierSources: async () => [storedPost("tier-1"), challengePage()] });
		const freshness = { bodyHash: "raw-body-hash", contentFetchedAt: NOW };

		await work({ ...postRequest, mode: "refresh", refresh: freshness });

		expect(deps.fetchRedditPostCard).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(refreshContent, expect.objectContaining({ input: expect.objectContaining({ freshness }) }));
		expect(deps.writeCanonicalContent).toHaveBeenCalledWith({ url: POST_URL, source: storedPost("tier-1") });
	});

	it.each(["save", "refresh"] as const)("preserves Reddit %s selection without asking for a card", async (mode) => {
		const { work, deps } = setupPost();
		const freshness = { bodyHash: "raw-body-hash", contentFetchedAt: NOW };
		if (mode === "refresh") await work({ ...postRequest, mode, refresh: freshness });
		else await work({ ...postRequest, mode });
		expect(deps.fetchRedditPostCard).toHaveBeenCalledTimes(0);
		expect(deps.writeCanonicalContent).toHaveBeenCalledTimes(0);
	});

	it("promotes the card through the recrawl transition", async () => {
		const { work, deps } = setupPost();

		await work({ ...postRequest, mode: "recrawl", candidates: [] });

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, expect.objectContaining({ input: expect.objectContaining({ winnerTier: "tier-1", metadata: expect.objectContaining({ title: CARD.title }) }) }));
	});

	it("lets the reader's own capture win without asking for a card", async () => {
		const { work, deps } = setupPost({ listAvailableTierSources: async () => [storedPost("tier-0"), challengePage()] });

		await work(postRequest);

		expect(deps.fetchRedditPostCard).not.toHaveBeenCalled();
		expect(comparisonLine(deps.logger)).toMatchObject({ selectionRule: "own-capture-over-verdict" });
	});

	it("verifies the stored card as the canonical of a later selection", async () => {
		const first = setupPost();
		await first.work(postRequest);
		const [{ tier, html, evaluationHtml, metadata: stored }] = jest.mocked(first.deps.putTierSource).mock.calls[0];

		const later = setupPost({
			loadArticle: async () => article({ url: POST_URL, contentSelection: { candidateId: stored.id, tier, revision: 1 } }),
			listAvailableTierSources: async () => [{ tier, html, evaluationHtml, metadata: stored }],
			fetchRedditPostCard: jest.fn(async () => undefined),
		});
		await later.work({ ...postRequest, saveAttemptId: laterRequest.saveAttemptId });

		expect(later.deps.writeCanonicalContent).toHaveBeenCalledWith({ url: POST_URL, source: expect.objectContaining({ html: CARD.html }) });
		expect(comparisonLine(later.deps.logger)).toMatchObject({ outcome: "retained" });
	});
});

describe("a redriven direct resource on the row it finds", () => {
	const A0 = SaveAttemptIdSchema.parse("attempt-0");
	const A1 = SaveAttemptIdSchema.parse("attempt-1");
	const A2 = SaveAttemptIdSchema.parse("attempt-2");
	const A3 = SaveAttemptIdSchema.parse("attempt-3");
	function directSource(params: { id: string; attemptId: SaveAttemptId; fetchedAt: string }): VerifiedTierSource {
		const html = `<pre>Plain text resource ${params.id}.</pre>`;
		return { tier: "tier-1", html, metadata: { ...candidateProvenance({
			metadata: { ...metadata, wordCount: 4, directResourceKind: "plain-text" }, html, evaluationHtml: html,
			attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: params.fetchedAt, httpStatus: 200,
		}), id: cid(params.id) } };
	}
	const C0 = directSource({ id: "c0", attemptId: A0, fetchedAt: "2026-10-01T00:00:00.000Z" });
	const C1 = directSource({ id: "c1", attemptId: A1, fetchedAt: "2026-10-02T00:00:00.000Z" });
	const C2 = directSource({ id: "c2", attemptId: A2, fetchedAt: "2026-10-03T00:00:00.000Z" });
	const C3 = directSource({ id: "c3", attemptId: A3, fetchedAt: "2026-10-04T00:00:00.000Z" });
	const message = (candidate: VerifiedTierSource, saveAttemptId: SaveAttemptId) => ({ ...request, saveAttemptId, candidates: [{ id: candidate.metadata.id, tier: candidate.tier }] });
	const committedAt = (params: { canonical: VerifiedTierSource; revision: number; overrides?: Partial<Article> }): Article => article({
		freshness: { contentFetchedAt: params.canonical.metadata.fetchedAt, etag: `etag-${params.canonical.metadata.id}`, canonicalContentHash: computeCanonicalContentHash(params.canonical.html) },
		contentSelection: { candidateId: params.canonical.metadata.id, tier: params.canonical.tier, revision: params.revision },
		...params.overrides,
	});

	function setupRow(params: { row: Article; sources: VerifiedTierSource[]; onFirstLoad?: () => Article }) {
		const rows = new Map([[URL, params.row]]);
		const effects: Effect[] = [];
		const order: string[] = [];
		let onFirstLoad = params.onFirstLoad;
		const { transitionAndPersist } = initTransitionAndPersist({
			store: {
				load: async (url) => rows.get(url),
				save: async ({ article: next, canonicalCommit }) => {
					assert(canonicalCommit, "selection always commits a candidate on these paths");
					const held = rows.get(next.url)?.contentSelection?.revision;
					if (canonicalCommit.expected?.revision !== held) throw new Error("selection revision changed");
					order.push("commit");
					rows.set(next.url, { ...next, contentSelection: { ...next.contentSelection, candidateId: canonicalCommit.candidateId, tier: canonicalCommit.tier, revision: (held ?? 0) + 1 } });
				},
			},
			dispatchEffect: async (effect) => { effects.push(effect); },
			logCrawlSettled: () => {},
		});
		const { work } = setup({
			loadArticle: async (url) => {
				const snapshot = rows.get(url);
				if (onFirstLoad) { rows.set(url, onFirstLoad()); onFirstLoad = undefined; }
				return snapshot;
			},
			listAvailableTierSources: async () => params.sources,
			transitionAndPersist,
			writeCanonicalContent: async ({ source }) => { order.push("upload"); return { contentLocation: "s3://bucket/immutable/content.html", candidateId: source.metadata.id, tier: source.tier }; },
			recordCrawlVersion: async () => { order.push("version"); },
		});
		return { work, row: () => rows.get(URL), effects, order };
	}

	it("keeps a canonical fetched later by another attempt when an older attempt's message is redriven", async () => {
		const start = committedAt({ canonical: C2, revision: 1 });
		const { work, row, effects, order } = setupRow({ row: start, sources: [C1, C2] });

		await work(message(C1, A1));

		expect(row()?.contentSelection?.candidateId).toBe(C2.metadata.id);
		expect(row()?.freshness).toEqual({ contentFetchedAt: NOW, etag: "etag-c2", canonicalContentHash: computeCanonicalContentHash(C2.html) });
		expect(row()?.summary).toEqual(start.summary);
		expect(effects).toEqual([{ kind: "publish-crawl-article-completed", url: URL }]);
		expect(order).toEqual(["upload", "commit"]);
	});

	it("leaves the row as the first run left it when the same message is delivered twice", async () => {
		const { work, row, order } = setupRow({ row: committedAt({ canonical: C2, revision: 1 }), sources: [C1, C2] });

		await work(message(C1, A1));
		const afterFirst = row();
		await work(message(C1, A1));

		assert(afterFirst?.contentSelection);
		expect(row()).toEqual({ ...afterFirst, contentSelection: { ...afterFirst.contentSelection, revision: 3 } });
		expect(order).toEqual(["upload", "commit", "upload", "commit"]);
	});

	it("heals a failed crawl onto the later canonical and regenerates its crawl-failed summary", async () => {
		const start = committedAt({ canonical: C2, revision: 1, overrides: { crawl: { kind: "failed", reason: { kind: "parse-error", detail: "S3 timeout" } }, summary: { kind: "failed", reason: { kind: "crawl-failed" } } } });
		const { work, row, effects } = setupRow({ row: start, sources: [C1, C2] });

		await work(message(C1, A1));

		expect(row()?.crawl).toEqual({ kind: "ready" });
		expect(row()?.contentSelection?.candidateId).toBe(C2.metadata.id);
		expect(row()?.summary).toMatchObject({ kind: "pending" });
		expect(effects).toEqual([{ kind: "generate-summary", url: URL }, { kind: "publish-crawl-article-completed", url: URL }]);
	});

	it("promotes the message's resource when the row holds no canonical", async () => {
		const start = article({ crawl: { kind: "failed", reason: { kind: "parse-error", detail: "S3 timeout" } }, summary: { kind: "failed", reason: { kind: "crawl-failed" } } });
		const { work, row, effects, order } = setupRow({ row: start, sources: [C1] });

		await work(message(C1, A1));

		expect(row()?.contentSelection?.candidateId).toBe(C1.metadata.id);
		expect(row()?.crawl).toEqual({ kind: "ready" });
		expect(row()?.summary).toMatchObject({ kind: "pending" });
		expect(effects).toEqual([{ kind: "publish-canonical-content-changed", url: URL }, { kind: "publish-crawl-article-completed", url: URL }]);
		expect(order).toEqual(["upload", "commit", "version"]);
	});

	it("promotes the message's resource over an older canonical with a different body", async () => {
		const { work, row, effects } = setupRow({ row: committedAt({ canonical: C0, revision: 1 }), sources: [C0, C1] });

		await work(message(C1, A1));

		expect(row()?.contentSelection?.candidateId).toBe(C1.metadata.id);
		expect(effects).toEqual([{ kind: "publish-canonical-content-changed", url: URL }, { kind: "publish-crawl-article-completed", url: URL }]);
	});

	it.each([["A1 then A2", [[C1, A1], [C2, A2]]], ["A2 then A1", [[C2, A2], [C1, A1]]]] as const)("ends on the later attempt's resource when two dead letters are redriven %s", async (_order, messages) => {
		const { work, row } = setupRow({ row: article(), sources: [C1, C2] });

		for (const [candidate, attemptId] of messages) await work(message(candidate, attemptId));

		expect(row()?.contentSelection?.candidateId).toBe(C2.metadata.id);
	});

	it("fails the commit that loses to a later commit and keeps that later canonical on the next receive", async () => {
		const { work, row, order } = setupRow({
			row: committedAt({ canonical: C0, revision: 1 }), sources: [C0, C1, C3],
			onFirstLoad: () => committedAt({ canonical: C3, revision: 2 }),
		});

		await expect(work(message(C1, A1))).rejects.toThrow("selection revision changed");
		await work(message(C1, A1));

		expect(row()?.contentSelection?.candidateId).toBe(C3.metadata.id);
		expect(order).toEqual(["upload", "upload", "commit"]);
	});

	it("keeps the later canonical through the recrawl tie when a recrawl message is redriven", async () => {
		const start = committedAt({ canonical: C2, revision: 1 });
		const { work, row, effects, order } = setupRow({ row: start, sources: [C1, C2] });

		await work({ ...message(C1, A1), mode: "recrawl" });

		expect(row()?.contentSelection?.candidateId).toBe(C2.metadata.id);
		expect(row()?.freshness).toEqual(start.freshness);
		expect(effects).toEqual([{ kind: "publish-recrawl-completed", url: URL }]);
		expect(order).toEqual(["upload", "commit"]);
	});

	it("keeps the later canonical when a refresh message is redriven", async () => {
		const { work, row } = setupRow({ row: committedAt({ canonical: C2, revision: 1 }), sources: [C1, C2] });

		await work({ ...message(C1, A1), mode: "refresh", refresh: { etag: "etag-c1", bodyHash: "body-hash-c1", contentFetchedAt: C1.metadata.fetchedAt } });

		expect(row()?.contentSelection?.candidateId).toBe(C2.metadata.id);
	});
});
