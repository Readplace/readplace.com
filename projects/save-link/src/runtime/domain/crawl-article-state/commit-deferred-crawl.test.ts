import { UserIdSchema } from "@packages/domain/user";
import { noopLogger } from "@packages/logger";
import { markCrawlBlocked, markCrawlFailed } from "@packages/domain/article-aggregate";
import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import {
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/infra-components";
import type { FinalizeArticle, FinalizedArticle } from "@packages/finalize-article";
import { initCommitDeferredCrawl } from "./commit-deferred-crawl";
import { candidateProvenance } from "@packages/tier-source";

type CommitDeps = Parameters<typeof initCommitDeferredCrawl>[0];

const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");
const url = "https://example-spa.test/post";

const renderedArticle: FinalizedArticle = {
	html: "<p>Rendered body</p>",
	metadata: {
		title: "Rendered",
		siteName: "example-spa.test",
		excerpt: "Rendered body",
		wordCount: 120,
		estimatedReadTime: 1,
		imageUrl: undefined,
	},
};

const okFinalize: FinalizeArticle = async () => ({ ok: true, article: renderedArticle });

function createCommit(overrides: Partial<CommitDeps> = {}) {
	const deps: CommitDeps = {
		resolveOriginalUrl: async (u) => u,
		finalizeArticle: okFinalize,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: () => new Date("2026-10-29T00:00:00.000Z"),
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		logPrefix: "[Test]",
		...overrides,
	};
	return { deps, ...initCommitDeferredCrawl(deps) };
}

const renderedBody = {
	html: "<html><body><p>Rendered body</p></body></html>",
	finalUrl: url,
	httpStatus: 200,
	bodyHash: "b".repeat(64),
};

describe("initCommitDeferredCrawl", () => {
	describe("commitFetchedBody", () => {
		it("stores a tier-1 live candidate and emits TierContentExtractedEvent for a first save", async () => {
			const { deps, commitFetchedBody } = createCommit();

			const outcome = await commitFetchedBody(renderedBody, { url, originalUrl: url, saveAttemptId, userId: UserIdSchema.parse("user-1") });

			expect(outcome).toEqual({ via: "deferred-to-event", readable: true, candidate: { id: expect.any(String), tier: "tier-1" } });
			expect(deps.putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				url,
				tier: "tier-1",
				html: renderedArticle.html,
				evaluationHtml: renderedArticle.html,
				metadata: expect.objectContaining({ kind: "live", httpStatus: 200, sourceUrl: url }),
			}));
			expect(deps.markCrawlStage).toHaveBeenCalledWith({ url, stage: "crawl-content-uploaded" });
			expect(deps.updateFetchTimestamp).toHaveBeenCalledWith({
				url,
				contentFetchedAt: "2026-10-29T00:00:00.000Z",
				etag: undefined,
				lastModified: undefined,
				bodyHash: renderedBody.bodyHash,
			});
			expect(deps.adoptCanonicalIdentity).toHaveBeenCalledWith({
				url,
				finalUrl: url,
				outcome: { kind: "finalized", wordCount: 120 },
				recrawl: false,
			});
			expect(deps.logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTier: "tier-1", thisTierStatus: "success" }));
			expect(deps.publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				url,
				userId: "user-1",
				saveAttemptId,
				candidates: [expect.objectContaining({ tier: "tier-1" })],
			}));
		});

		it("hands an unreadable body to selection beside existing candidates and says it was unreadable", async () => {
			const { commitFetchedBody } = createCommit({ finalizeArticle: async () => ({ ok: false, reason: "empty document" }) });

			const outcome = await commitFetchedBody(renderedBody, { url, originalUrl: url, saveAttemptId, candidates: [{ id: CandidateIdSchema.parse("wrapper-candidate"), tier: "tier-2" }] });

			expect(outcome).toEqual({ via: "deferred-to-event", readable: false, candidate: { id: expect.any(String), tier: "tier-1" } });
		});

		it("emits RecrawlContentExtractedEvent on a recrawl", async () => {
			const { deps, commitFetchedBody } = createCommit();

			await commitFetchedBody(renderedBody, { url, originalUrl: url, saveAttemptId, recrawl: true });

			expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({ url, saveAttemptId }));
		});

		it("carries freshness on RefreshContentExtractedEvent and skips the fetch-timestamp command on a refresh", async () => {
			const { deps, commitFetchedBody } = createCommit();

			await commitFetchedBody({ ...renderedBody, etag: "\"v2\"", lastModified: "Tue, 28 Oct 2026 00:00:00 GMT" }, {
				url,
				originalUrl: url,
				saveAttemptId,
				refresh: true,
			});

			expect(deps.updateFetchTimestamp).not.toHaveBeenCalled();
			expect(deps.publishEvent).toHaveBeenCalledWith(RefreshContentExtractedEvent, expect.objectContaining({
				url,
				etag: "\"v2\"",
				lastModified: "Tue, 28 Oct 2026 00:00:00 GMT",
				bodyHash: renderedBody.bodyHash,
			}));
		});

		it("returns unreadable without writing anything when finalize fails and no other candidate exists", async () => {
			const { deps, commitFetchedBody } = createCommit({
				finalizeArticle: async () => ({ ok: false, reason: "no readable content" }),
			});

			const outcome = await commitFetchedBody(renderedBody, { url, originalUrl: url, saveAttemptId });

			expect(outcome).toEqual({ via: "unreadable", reason: "no readable content" });
			expect(deps.putTierSource).not.toHaveBeenCalled();
			expect(deps.transitionAndPersist).not.toHaveBeenCalled();
			expect(deps.publishEvent).not.toHaveBeenCalled();
		});

		it("stores a failed live attempt beside the existing candidates when finalize fails", async () => {
			const { deps, commitFetchedBody } = createCommit({
				finalizeArticle: async () => ({ ok: false, reason: "no readable content" }),
			});
			const archived = { id: CandidateIdSchema.parse("archive-candidate"), tier: "tier-2" as const };

			await commitFetchedBody({ ...renderedBody, evaluationHtml: "<main>shell</main>" }, {
				url,
				originalUrl: url,
				saveAttemptId,
				candidates: [archived],
			});

			expect(deps.putTierSource).toHaveBeenCalledWith(expect.objectContaining({ html: "", evaluationHtml: "<main>shell</main>" }));
			expect(deps.updateFetchTimestamp).not.toHaveBeenCalled();
			expect(deps.adoptCanonicalIdentity).toHaveBeenCalledWith(expect.objectContaining({ outcome: { kind: "crawl-failed" } }));
			expect(deps.logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTierStatus: "failed" }));
			expect(deps.publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				candidates: [archived, expect.objectContaining({ tier: "tier-1" })],
			}));
		});

		it("evaluates the raw body when other candidates exist and the fetch carries no evaluation html", async () => {
			const { deps, commitFetchedBody } = createCommit();

			await commitFetchedBody(renderedBody, { url, originalUrl: url, saveAttemptId, candidates: [] });

			expect(deps.putTierSource).toHaveBeenCalledWith(expect.objectContaining({ evaluationHtml: renderedBody.html }));
		});

		it("treats a non-2xx body as a failed live attempt", async () => {
			const { deps, commitFetchedBody } = createCommit();

			await commitFetchedBody({ ...renderedBody, httpStatus: 500 }, { url, originalUrl: url, saveAttemptId });

			expect(deps.updateFetchTimestamp).not.toHaveBeenCalled();
			expect(deps.adoptCanonicalIdentity).toHaveBeenCalledWith(expect.objectContaining({ outcome: { kind: "crawl-failed" } }));
		});

		it("treats a 1xx body as a failed live attempt", async () => {
			const { deps, commitFetchedBody } = createCommit();

			await commitFetchedBody({ ...renderedBody, httpStatus: 103 }, { url, originalUrl: url, saveAttemptId });

			expect(deps.adoptCanonicalIdentity).toHaveBeenCalledWith(expect.objectContaining({ outcome: { kind: "crawl-failed" } }));
		});

		it("forwards a plain-text body and falls back to the original url as the source without a final url", async () => {
			const finalizeArticle = jest.fn<ReturnType<FinalizeArticle>, Parameters<FinalizeArticle>>().mockResolvedValue({ ok: true, article: renderedArticle });
			const { deps, commitFetchedBody } = createCommit({ finalizeArticle });

			await commitFetchedBody(
				{ html: "", bodyHash: "c".repeat(64), mediaType: "plain-text", plainText: "hello" },
				{ url, originalUrl: "https://example-spa.test/original", saveAttemptId },
			);

			expect(finalizeArticle).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "plain-text", plainText: "hello" }));
			expect(deps.putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				metadata: expect.objectContaining({ sourceUrl: "https://example-spa.test/original" }),
			}));
		});
		it.each<{ mode: "save" | "recrawl" | "refresh"; httpStatus: number }>([
			{ mode: "save", httpStatus: 200 },
			{ mode: "save", httpStatus: 404 },
			{ mode: "recrawl", httpStatus: 200 },
			{ mode: "refresh", httpStatus: 200 },
		])("commits a $mode body with HTTP $httpStatus beside the existing candidates in a fixed call order", async ({ mode, httpStatus }) => {
			const trace: unknown[][] = [];
			let tick = 0;
			const record = (name: string) => async (params: unknown) => {
				trace.push([name, params]);
			};
			const { commitFetchedBody } = createCommit({
				resolveOriginalUrl: async (u) => {
					trace.push(["resolveOriginalUrl", u]);
					return "https://example-spa.test/original";
				},
				finalizeArticle: async () => {
					trace.push(["finalizeArticle"]);
					return { ok: true, article: renderedArticle };
				},
				putTierSource: record("putTierSource"),
				updateFetchTimestamp: record("updateFetchTimestamp"),
				markCrawlStage: record("markCrawlStage"),
				adoptCanonicalIdentity: record("adoptCanonicalIdentity"),
				publishEvent: async (event, detail) => {
					trace.push(["publishEvent", event.detailType, detail]);
				},
				readTierSnapshot: async (params) => {
					trace.push(["readTierSnapshot", params]);
					return { tier0Status: "failed", tier1Status: "not_attempted", pickedTier: "none" };
				},
				logCrawlOutcome: (params) => {
					trace.push(["logCrawlOutcome", params]);
				},
				logger: { ...noopLogger, info: (message, context) => trace.push(["logger.info", message, context]) },
				now: () => {
					tick += 1;
					trace.push(["now"]);
					return new Date(Date.UTC(2026, 9, 29, 0, 0, tick));
				},
			});
			const archived = { id: CandidateIdSchema.parse("archive-candidate"), tier: "tier-2" as const };
			const body = { ...renderedBody, httpStatus, evaluationHtml: "<main>raw</main>", etag: "\"v2\"", lastModified: "Tue, 28 Oct 2026 00:00:00 GMT", finalUrl: "https://example-spa.test/final", renderedThrough: "residential-proxy" as const };

			const outcome = await commitFetchedBody(body, {
				url,
				originalUrl: "https://example-spa.test/saved",
				saveAttemptId,
				candidates: [archived],
				userId: UserIdSchema.parse("user-1"),
				recrawl: mode === "recrawl" ? true : undefined,
				refresh: mode === "refresh" ? true : undefined,
			});

			const failed = httpStatus !== 200;
			const metadata = candidateProvenance({
				metadata: renderedArticle.metadata,
				html: renderedArticle.html,
				evaluationHtml: "<main>raw</main>",
				attemptId: saveAttemptId,
				originalUrl: "https://example-spa.test/original",
				sourceUrl: "https://example-spa.test/final",
				kind: "live",
				fetchedAt: "2026-10-29T00:00:01.000Z",
				httpStatus,
				renderedThrough: "residential-proxy",
			});
			const candidates = [archived, { id: metadata.id, tier: "tier-1" }];
			const contentFetchedAt = "2026-10-29T00:00:02.000Z";
			const announcements: Record<typeof mode, unknown[][]> = {
				save: [
					["publishEvent", TierContentExtractedEvent.detailType, { url, userId: "user-1", extractedAt: contentFetchedAt, candidates, saveAttemptId }],
					["logger.info", "[Test] emitted TierContentExtractedEvent", { url, tier: "tier-1" }],
				],
				recrawl: [
					["publishEvent", RecrawlContentExtractedEvent.detailType, { url, extractedAt: contentFetchedAt, candidates, saveAttemptId }],
					["logger.info", "[Test] emitted RecrawlContentExtractedEvent", { url }],
				],
				refresh: [
					["publishEvent", RefreshContentExtractedEvent.detailType, { url, candidates, saveAttemptId, etag: "\"v2\"", lastModified: "Tue, 28 Oct 2026 00:00:00 GMT", contentFetchedAt, bodyHash: renderedBody.bodyHash }],
					["logger.info", "[Test] emitted RefreshContentExtractedEvent", { url }],
				],
			};
			expect(outcome).toEqual({ via: "deferred-to-event", readable: true, candidate: { id: metadata.id, tier: "tier-1" } });
			expect(trace).toStrictEqual([
				["now"],
				["finalizeArticle"],
				["adoptCanonicalIdentity", { url, finalUrl: "https://example-spa.test/final", outcome: failed ? { kind: "crawl-failed" } : { kind: "finalized", wordCount: 120 }, recrawl: mode !== "save" }],
				["resolveOriginalUrl", url],
				["putTierSource", { url, tier: "tier-1", html: renderedArticle.html, evaluationHtml: "<main>raw</main>", metadata }],
				["markCrawlStage", { url, stage: "crawl-content-uploaded" }],
				["now"],
				...(mode !== "refresh" && !failed
					? [["updateFetchTimestamp", { url, contentFetchedAt, etag: "\"v2\"", lastModified: "Tue, 28 Oct 2026 00:00:00 GMT", bodyHash: renderedBody.bodyHash }]]
					: []),
				["readTierSnapshot", { url }],
				["logCrawlOutcome", { url, thisTier: "tier-1", thisTierStatus: failed ? "failed" : "success", otherTierStatus: "failed", pickedTier: "none" }],
				...announcements[mode],
			]);
		});
	});

	describe("commitReadableBody", () => {
		it("returns unreadable without writing anything when finalize fails, even beside existing candidates", async () => {
			const { deps, commitReadableBody } = createCommit({
				finalizeArticle: async () => ({ ok: false, reason: "no readable content" }),
			});
			const archived = { id: CandidateIdSchema.parse("archive-candidate"), tier: "tier-2" as const };

			const outcome = await commitReadableBody(renderedBody, { url, originalUrl: url, saveAttemptId, candidates: [archived] });

			expect(outcome).toEqual({ via: "unreadable", reason: "no readable content" });
			expect(deps.putTierSource).not.toHaveBeenCalled();
			expect(deps.transitionAndPersist).not.toHaveBeenCalled();
			expect(deps.publishEvent).not.toHaveBeenCalled();
		});

		it("commits a readable body as a tier-1 live candidate the same way commitFetchedBody does", async () => {
			const { deps, commitReadableBody } = createCommit();

			const outcome = await commitReadableBody(renderedBody, { url, originalUrl: url, saveAttemptId, userId: UserIdSchema.parse("user-1") });

			expect(outcome).toEqual({ via: "deferred-to-event", readable: true, candidate: { id: expect.any(String), tier: "tier-1" } });
			expect(deps.putTierSource).toHaveBeenCalledWith(expect.objectContaining({
				url,
				tier: "tier-1",
				html: renderedArticle.html,
				metadata: expect.objectContaining({ kind: "live", httpStatus: 200, sourceUrl: url }),
			}));
			expect(deps.publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
				url,
				userId: "user-1",
				saveAttemptId,
				candidates: [expect.objectContaining({ tier: "tier-1" })],
			}));
		});
	});

	describe("resolveUnreadable", () => {
		it("marks the crawl failed with a parse-error carrying the given detail", async () => {
			const { deps, resolveUnreadable } = createCommit();

			const outcome = await resolveUnreadable({ url, detail: "no readable content" });

			expect(outcome).toEqual({ via: "committed-in-process" });
			expect(deps.logParseError).toHaveBeenCalledWith({ url, reason: "no readable content" });
			expect(deps.logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTierStatus: "failed" }));
			expect(deps.transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
				url,
				input: { reason: { kind: "parse-error", detail: "no readable content" } },
			});
		});
	});

	describe("resolveBlocked", () => {
		it("marks the crawl blocked with the cause for the status", async () => {
			const { deps, resolveBlocked } = createCommit();

			const outcome = await resolveBlocked({ url, httpStatus: 403 });

			expect(outcome).toEqual({ via: "committed-in-process" });
			expect(deps.logParseError).toHaveBeenCalledWith({ url, reason: "crawl-blocked: HTTP 403" });
			expect(deps.transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
				url,
				input: { reason: { kind: "blocked", cause: "edge-block" } },
			});
		});
	});

	describe("resolveBudgetExhausted", () => {
		it("marks the crawl blocked as spend-capped", async () => {
			const { deps, resolveBudgetExhausted } = createCommit();

			const outcome = await resolveBudgetExhausted({ url, saveAttemptId });

			expect(outcome).toEqual({ via: "committed-in-process" });
			expect(deps.logParseError).toHaveBeenCalledWith({ url, reason: "paid-crawl-budget-exhausted" });
			expect(deps.transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
				url,
				input: { reason: { kind: "blocked", cause: "spend-capped" } },
			});
		});

		it("leaves a refreshed article's prior canonical in place", async () => {
			const { deps, resolveBudgetExhausted } = createCommit();

			const outcome = await resolveBudgetExhausted({ url, saveAttemptId, refresh: true });

			expect(outcome).toEqual({ via: "already-terminal" });
			expect(deps.transitionAndPersist).not.toHaveBeenCalled();
		});

		it("hands existing candidates to selection with no live body", async () => {
			const { deps, resolveBudgetExhausted } = createCommit();
			const archived = { id: CandidateIdSchema.parse("archive-candidate"), tier: "tier-2" as const };

			const outcome = await resolveBudgetExhausted({ url, saveAttemptId, userId: UserIdSchema.parse("user-1"), candidates: [archived] });

			expect(outcome).toEqual({ via: "deferred-to-event" });
			expect(deps.transitionAndPersist).not.toHaveBeenCalled();
			expect(deps.publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
				url,
				userId: "user-1",
				saveAttemptId,
				candidates: [archived],
				liveAttempt: { outcome: "no-body" },
				extractedAt: "2026-10-29T00:00:00.000Z",
			});
		});
	});

	describe("publishArchiveComparison", () => {
		it("emits RecrawlContentExtractedEvent on a recrawl", async () => {
			const { deps, publishArchiveComparison } = createCommit();

			const outcome = await publishArchiveComparison({ url, saveAttemptId, recrawl: true, candidates: [] });

			expect(outcome).toEqual({ via: "deferred-to-event" });
			expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({
				url,
				liveAttempt: { outcome: "no-body" },
			}));
		});
	});
});
