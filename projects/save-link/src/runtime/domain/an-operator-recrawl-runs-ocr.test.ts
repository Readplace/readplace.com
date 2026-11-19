import { noopLogger } from "@packages/logger";
import { initCrawlArticle, rejectDocumentLandingPage, type ExtractPdf } from "@packages/crawl-article";
import { markCrawlAwaitingReader } from "@packages/domain/article-aggregate";
import type { UserId } from "@packages/article-state-types";
import { UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { EmitSimpleCrawlUnsupported } from "../dep-bundles/events";
import { initRecrawlLinkInitiatedHandler } from "./save-link/recrawl-link-initiated-handler";
import { initComprehensiveCrawlHandler } from "./comprehensive-crawl/comprehensive-crawl-handler";
import { initRunMeteredLeg } from "./metered-leg/run-metered-leg";

const URL = "https://example.com/report.pdf";
const NOW = new Date("2026-11-17T00:00:00.000Z");
const readerId = UserIdSchema.parse("00000000000000000000000000000001");
const tier1Fetch = { status: "unsupported", reason: "pdf", unsupportedReason: { kind: "non-html-content", contentType: "application/pdf" } } as const;

function recrawlBody(requester: { kind: "operator" } | { kind: "reader"; userId: UserId }) {
	return JSON.stringify({ detail: { url: URL, saveAttemptId: "attempt-1", requester } });
}

async function recrawlForwardedToComprehensive(requester: { kind: "operator" } | { kind: "reader"; userId: UserId }) {
	const forwarded: Parameters<EmitSimpleCrawlUnsupported>[0][] = [];
	const recrawl = initRecrawlLinkInitiatedHandler({
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		resolveOriginalUrl: async (url) => url,
		crawlAndFinalizeArticle: async () => tier1Fetch,
		emitSimpleCrawlUnsupported: async (params) => { forwarded.push(params); },
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		isSiteRuleUrl: () => false,
		publishEvent: initRecordingPublishEvent().publishEvent,
		now: () => NOW,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		findContentSourceUrl: async () => undefined,
	});
	await recrawl(buildSqsEvent([{ messageId: "recrawl-1", body: recrawlBody(requester) }]), buildLambdaContext(), () => {});
	expect(forwarded).toHaveLength(1);
	const { url, userId, trigger, previousBodyHash, saveAttemptId, candidates } = forwarded[0];
	return { url, userId, trigger, previousBodyHash, saveAttemptId, candidates };
}

async function comprehensiveCrawl(command: Awaited<ReturnType<typeof recrawlForwardedToComprehensive>>) {
	const charged: { userId: UserId; claimId: string }[] = [];
	const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
	const extractPdf: ExtractPdf = jest.fn(async ({ chargeOcrPages }) => {
		const charge = await chargeOcrPages({ pages: 12 });
		expect(charge).toEqual({ allowed: true });
		return { kind: "fetched" as const, title: "PDF report", html: "<html><body><p>The scanned report, read by OCR.</p></body></html>" };
	});
	const pdf = Buffer.from(`%PDF-1.4\n${" ".repeat(64)}`);
	const handler = initComprehensiveCrawlHandler({
		resolveOriginalUrl: async (url) => url,
		prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		crawlArticleWithPermit: ({ permit: _permit, ...params }) => initCrawlArticle({
			rejectDocumentLandingPage,
			crawlFetch: async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
			siteRules: [],
			extractPdf,
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		})(params),
		chargeOcrPagesFor: (params) => {
			charged.push(params);
			return async () => ({ allowed: true });
		},
		markOcrPagesHeld: jest.fn().mockResolvedValue(undefined),
		runMeteredLeg: initRunMeteredLeg({
			...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }),
			logger: noopLogger,
			now: () => NOW,
		}),
		finalizeArticle: async () => ({ ok: true, article: { html: "<p>The scanned report, read by OCR.</p>", metadata: { title: "PDF report", siteName: "example.com", excerpt: "", wordCount: 6, estimatedReadTime: 1, imageUrl: undefined } } }),
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist,
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		markCrawlProgress: jest.fn().mockResolvedValue(undefined),
		consumePaidCrawlBudget: jest.fn().mockResolvedValue({ allowed: true, consumed: true }),
		refundPaidCrawlBudget: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		publishEvent: initRecordingPublishEvent().publishEvent,
		now: () => NOW,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
	});
	const response = await handler(buildSqsEvent([{ messageId: "comprehensive-1", body: JSON.stringify({ detail: command }) }]), buildLambdaContext(), () => {});
	expect(response).toEqual({ batchItemFailures: [] });
	return { charged, extractPdf, transitionAndPersist };
}

describe("a recrawl of a PDF through the recrawl and comprehensive-crawl handlers", () => {
	it("runs OCR for an operator's recrawl, charging no account", async () => {
		const command = await recrawlForwardedToComprehensive({ kind: "operator" });

		const { charged, extractPdf, transitionAndPersist } = await comprehensiveCrawl(command);

		expect(extractPdf).toHaveBeenCalledTimes(1);
		expect(charged).toEqual([]);
		expect(transitionAndPersist).not.toHaveBeenCalledWith(markCrawlAwaitingReader, expect.anything());
	});

	it("charges the reader whose action asked for the recrawl", async () => {
		const command = await recrawlForwardedToComprehensive({ kind: "reader", userId: readerId });

		const { charged, extractPdf } = await comprehensiveCrawl(command);

		expect(extractPdf).toHaveBeenCalledTimes(1);
		expect(charged).toEqual([{ userId: readerId, claimId: "comprehensive-1" }]);
	});
});
