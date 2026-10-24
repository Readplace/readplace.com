import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { initCrawlArticle, initCrawlFetch } from "@packages/crawl-article";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import { noopLogger } from "@packages/hutch-logger";
import { initVerifyWrapperSource } from "@packages/save-article";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { candidateProvenance } from "../select-content/candidate-provenance";
import { initListAvailableTierSources } from "../select-content/list-available-tier-sources";
import { initPrepareContentSelection } from "../select-content/prepare-content-selection";
import { type CreateSelectorChatCompletion, initSelectMostCompleteContent } from "../select-content/select-content";
import type { VerifiedTierSource } from "../select-content/tier-source.types";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";

const ORIGINAL = "https://example.com/article";
const CAPTURE = `https://web.archive.org/web/${ORIGINAL}`;
const ATTEMPT = SaveAttemptIdSchema.parse("calendar-save-after-rate-limit");
const NOW = "2026-10-24T00:00:00.000Z";

it("judges the retained archive 429 after the retry and proxy fail, and keeps the existing readable article", async () => {
	const rateLimitedHtml = "<html><head><title>Too Many Requests</title></head><body><p>Archive request limit exceeded. Please try again later.</p></body></html>";
	let primaryCalls = 0;
	const crawlFetch = initCrawlFetch({
		fetch: async () => {
			primaryCalls += 1;
			if (primaryCalls === 1) return new Response(rateLimitedHtml, { status: 429, headers: { "content-type": "text/html" } });
			throw Object.assign(new Error("connect ECONNREFUSED 207.241.237.3:443"), { code: "ECONNREFUSED" });
		},
		fetchH2: async () => new Response(rateLimitedHtml, { status: 429, headers: { "content-type": "text/html" } }),
		fetchCurl: async () => new Response(rateLimitedHtml, { status: 429, headers: { "content-type": "text/html" } }),
		personas: [{ name: "test", headers: { "user-agent": "test" } }],
		proxyUrl: "http://proxy.example:8080",
		rateLimitRetryDelaysMs: [0],
		resolve: (_hostname, _options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }]),
		isBlocked: () => false,
		logInfo: () => {},
	});
	const crawlArticle = initCrawlArticle({ crawlFetch, siteRules: [], logError: () => {}, logInfo: () => {} });
	const { parseHtml } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: () => {} });
	const finalizeArticle = initFinalizeArticle({
		parseHtml,
		downloadMedia: async () => [],
		processContent: async ({ html }) => html,
		fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }),
		putImageObject: async () => {},
		imagesCdnBaseUrl: "https://cdn.example.com",
	});
	const canonicalHtml = "<p>The saved report explains how a film crew built its original digital production workflow.</p>";
	const canonical: VerifiedTierSource = {
		tier: "tier-2",
		html: canonicalHtml,
		evaluationHtml: canonicalHtml,
		metadata: candidateProvenance({
			metadata: { title: "Saved report", siteName: "example.com", excerpt: "Digital production workflow", wordCount: 17, estimatedReadTime: 1 },
			html: canonicalHtml,
			evaluationHtml: canonicalHtml,
			attemptId: SaveAttemptIdSchema.parse("yesterday"),
			originalUrl: ORIGINAL,
			sourceUrl: CAPTURE,
			kind: "wrapper",
			fetchedAt: "2026-10-23T00:00:00.000Z",
			httpStatus: 200,
		}),
	};
	const stored: VerifiedTierSource[] = [canonical];
	const verifyWrapperSource = initVerifyWrapperSource({
		findIdentityRow: async () => ({ kind: "article", originalUrl: ORIGINAL }),
		resolveWrapperTarget: async () => undefined,
	});
	const capture = await initCrawlArchiveCapture({
		crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle }),
		putTierSource: async (source) => { stored.push(source); },
		readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "failed", pickedTier: "tier-2" }),
		verifyWrapperSource,
		logCrawlOutcome: () => {},
		publishEvent: async () => {},
		logger: noopLogger,
		now: () => new Date(NOW),
	})({ url: ORIGINAL, captureUrl: CAPTURE, saveAttemptId: ATTEMPT });
	assert(capture, "a received archive response must survive later transport failures as a candidate");
	const fresh = stored.find((source) => source.metadata.id === capture.id);
	assert(fresh);
	const createChatCompletion = jest.fn<ReturnType<CreateSelectorChatCompletion>, Parameters<CreateSelectorChatCompletion>>()
		.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
			kind: "winner", candidate: "B", reason: "The fresh archive response is a rate-limit page; the saved article is readable",
			readability: [{ candidate: "A", readable: false }, { candidate: "B", readable: true }],
		}) } }] });
	const selection = await initPrepareContentSelection({
		loadArticle: async () => ({
			url: ORIGINAL,
			metadata: canonical.metadata,
			estimatedReadTime: 1,
			freshness: { contentFetchedAt: canonical.metadata.fetchedAt, canonicalContentHash: computeCanonicalContentHash(canonicalHtml) },
			crawl: { kind: "ready" },
			summary: { kind: "ready", summary: "Existing summary" },
			summaryAutoHeal: { attempts: 0 },
			contentSelection: { revision: 1, tier: canonical.tier, candidateId: canonical.metadata.id },
		}),
		readCanonicalContent: async () => undefined,
		...initListAvailableTierSources({ readTierSource: async ({ tier, candidateId }) => stored.find((source) => source.tier === tier && source.metadata.id === candidateId) }),
		resolveOriginalUrl: async () => ORIGINAL,
		verifyWrapperSource,
		...initSelectMostCompleteContent({ createChatCompletion, logger: noopLogger }),
	})({ url: ORIGINAL, saveAttemptId: ATTEMPT, candidates: [capture] });

	expect(primaryCalls).toBe(3);
	expect(fresh).toMatchObject({
		evaluationHtml: rateLimitedHtml,
		metadata: { attemptId: ATTEMPT, originalUrl: ORIGINAL, sourceUrl: CAPTURE, kind: "wrapper", httpStatus: 429, contentHash: createHash("sha256").update(rateLimitedHtml).digest("hex") },
	});
	expect(createChatCompletion).toHaveBeenCalledTimes(1);
	const request = createChatCompletion.mock.calls[0][0];
	expect(request.messages[1].content).toContain("HTTP=429");
	expect(request.messages[1].content).toContain("Archive request limit exceeded");
	expect(selection.audit?.judgedCandidates).toContainEqual({ id: fresh.metadata.id, contentHash: fresh.metadata.contentHash });
	expect(selection.readableIds).toEqual(new Set([canonical.metadata.id]));
	expect(selection).toMatchObject({ outcome: "retained", selectionRule: "judge", selected: { metadata: { id: canonical.metadata.id, attemptId: "yesterday" } } });
});
