import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent, type SelectMostCompleteContent } from "./select-content";
import { initSelectContentWork } from "./select-content-work";
import { noopLogger } from "@packages/hutch-logger";
import type { CreateAiMessage } from "@packages/ai-message";
import { MAX_SUMMARY_LENGTH } from "@packages/provider-contracts/article-summary";
import {
	type Article,
	type DispatchEffect,
	initTransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { initGenerateSummaryHandler } from "../generate-summary/generate-summary-handler";
import { initCanonicalContentChangedHandler } from "../save-link/canonical-content-changed-handler";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { initLinkSummariser, type SummarizeArticle } from "../generate-summary/link-summariser";
import { stripHtml } from "../generate-summary/strip-html";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";
import { candidateProvenance } from "./candidate-provenance";
import type { VerifiedTierSource } from "./tier-source.types";
import type { Handler, SQSBatchResponse, SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

/**
 * In-process replay of the production incident: a row whose summary is
 * `skipped(content-too-short)` from a transient degraded crawl, where the real
 * content later becomes canonical via a TIER FLIP that hashes identically to a
 * value already recorded (canonicalChanged=true, contentChanged=false). Before
 * the CanonicalContentChanged event, promoteTier gated regeneration on
 * contentChanged only, so the summary stayed permanently skipped. This wires
 * the real selector → promoteTier → CanonicalContentChanged subscriber →
 * markSummaryPending → generate-summary worker and asserts the row recovers to
 * `ready`.
 */

const URL = "https://example.com/article";
const FIXED_NOW = new Date("2026-05-31T10:00:00.000Z");
const CANONICAL_HTML = "<article><p>The genuine, full-length article body.</p></article>";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function sqsEvent(detail: Record<string, unknown>): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:summary-recovery",
			awsRegion: "ap-southeast-2",
		}],
	};
}

function stuckArticle(canonicalContentHash: string): Article {
	return {
		url: URL,
		metadata: { title: "Title", siteName: "example.com", excerpt: "x", wordCount: 1123 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z", canonicalContentHash },
		estimatedReadTime: 5,
		crawl: { kind: "ready" },
		summary: { kind: "skipped", reason: "content-too-short" },
		summaryAutoHeal: { attempts: 0 },
		contentSelection: { tier: "tier-0" },
	};
}

describe("summary recovery on canonical content change", () => {
	it.each(["image", "plain-text"] satisfies Array<"image" | "plain-text">)("persists a verified %s resource despite a historical rejected crawl and completes its summary lifecycle", async (directResourceKind) => {
		const attemptId = SaveAttemptIdSchema.parse("resource-attempt");
		const html = directResourceKind === "image"
			? '<img src="https://cdn.example.com/resource.png">'
			: `<pre>${"A detailed plain text resource documents the operating procedure and its supporting evidence. ".repeat(100)}</pre>`;
		const resource: VerifiedTierSource = { tier: "tier-1", html, metadata: candidateProvenance({
			metadata: { title: "Resource", siteName: "example.com", excerpt: "", wordCount: directResourceKind === "image" ? 0 : 1500, estimatedReadTime: 1, directResourceKind },
			html, evaluationHtml: html, attemptId, originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: FIXED_NOW.toISOString(), httpStatus: 200,
		}) };
		const rejectedHtml = "<p>Page not found</p>";
		const historical: VerifiedTierSource = { tier: "tier-1", html: rejectedHtml, metadata: candidateProvenance({
			metadata: { title: "Not found", siteName: "example.com", excerpt: "", wordCount: 3, estimatedReadTime: 1 },
			html: rejectedHtml, evaluationHtml: rejectedHtml, attemptId: SaveAttemptIdSchema.parse("earlier-attempt"),
			originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: "2026-01-01T00:00:00.000Z", httpStatus: 404,
		}) };
		const store = initInMemoryArticleStore();
		store.seed({
			url: URL, metadata: { title: "Not found", siteName: "example.com", excerpt: "", wordCount: 0 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" }, estimatedReadTime: 1,
			crawl: { kind: "failed", reason: { kind: "not-found", httpStatus: 404 } },
			summary: { kind: "skipped", reason: "crawl-failed" }, summaryAutoHeal: { attempts: 0 },
		});
		const bodies = new Map<string, string>();
		const findArticleContent: FindArticleContent = async (url) => {
			const row = await store.load(url);
			const location = row?.contentSelection?.contentLocation;
			const content = location === undefined ? undefined : bodies.get(location);
			return content === undefined ? undefined : { content };
		};
		const createMessage = jest.fn<ReturnType<CreateAiMessage>, Parameters<CreateAiMessage>>(async () => ({
			content: [{ type: "text", text: JSON.stringify({ summary: "The resource explains its operating procedure.", excerpt: "An operating procedure." }) }],
			usage: { input_tokens: 100, output_tokens: 20 },
		}));
		const { summarizeArticle } = initLinkSummariser({
			createMessage, markSummaryStage: async () => {}, logger: noopLogger, cleanContent: stripHtml,
			isTooShortToSummarize: (text) => text.replace(/\s/g, "").length <= MAX_SUMMARY_LENGTH * 3,
		});
		let summaryHandler: Handler<SQSEvent, SQSBatchResponse>;
		let canonicalChangedHandler: Handler<SQSEvent, SQSBatchResponse>;
		const dispatchEffect: DispatchEffect = async (effect) => {
			if (effect.kind === "publish-canonical-content-changed") {
				await canonicalChangedHandler(sqsEvent({ url: effect.url }), buildLambdaContext(), () => {});
			} else if (effect.kind === "generate-summary") {
				await summaryHandler(sqsEvent({ url: effect.url }), buildLambdaContext(), () => {});
			}
		};
		const { transitionAndPersist } = initTransitionAndPersist({ store, dispatchEffect });
		summaryHandler = initGenerateSummaryHandler({ summarizeArticle, findArticleContent, loadArticle: store.load, transitionAndPersist, now: () => FIXED_NOW, logger: noopLogger });
		canonicalChangedHandler = initCanonicalContentChangedHandler({ findArticleContent, transitionAndPersist, now: () => FIXED_NOW, logger: noopLogger });
		const judge = jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>();
		const recordCrawlVersion = jest.fn(async () => {});
		const work = initSelectContentWork({
			listAvailableTierSources: async () => [historical, resource], selectMostCompleteContent: judge,
			writeCanonicalContent: async ({ source }) => {
				const contentLocation = `s3://content/${source.metadata.id}.html`;
				bodies.set(contentLocation, source.html);
				return { contentLocation, candidateId: source.metadata.id, tier: source.tier };
			},
			recordCrawlVersion, loadArticle: store.load, readCanonicalContent: findArticleContent, transitionAndPersist,
			resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
			now: () => FIXED_NOW, logger: noopLogger,
		});

		await work({ url: URL, saveAttemptId: attemptId, candidates: [{ id: resource.metadata.id, tier: "tier-1" }], mode: "recrawl" });

		const persisted = await store.load(URL);
		expect(judge).toHaveBeenCalledTimes(0);
		expect(persisted?.contentSelection).toMatchObject({ candidateId: resource.metadata.id, tier: "tier-1", contentLocation: `s3://content/${resource.metadata.id}.html` });
		expect(await findArticleContent(URL)).toEqual({ content: html });
		expect(persisted?.crawl).toEqual({ kind: "ready" });
		expect(persisted?.freshness.canonicalContentHash).toBe(computeCanonicalContentHash(html));
		expect(persisted?.summary).toMatchObject(directResourceKind === "image" ? { kind: "skipped", reason: "content-too-short" } : { kind: "ready", summary: "The resource explains its operating procedure.", sourceContentHash: computeCanonicalContentHash(html) });
		expect(createMessage).toHaveBeenCalledTimes(directResourceKind === "image" ? 0 : 1);
		expect(recordCrawlVersion).toHaveBeenCalledTimes(1);
	});

	it("recovers a row stuck at skipped(content-too-short) when the tier flips to the same-hash canonical content", async () => {
		/* The winning tier-1 source's content hashes to exactly the value already
		 * recorded on the row — so contentChanged is false. Only the TIER flips. */
		const canonicalHash = computeCanonicalContentHash(CANONICAL_HTML);
		const tier1: VerifiedTierSource = {
			tier: "tier-1",
			html: CANONICAL_HTML,
			metadata: candidateProvenance({ metadata: { title: "Title", siteName: "example.com", excerpt: "x", wordCount: 1123, estimatedReadTime: 5 }, html: CANONICAL_HTML, evaluationHtml: CANONICAL_HTML, attemptId: SaveAttemptIdSchema.parse("attempt"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: FIXED_NOW.toISOString() }),
		};

		const store = initInMemoryArticleStore();
		store.seed(stuckArticle(canonicalHash));

		const findArticleContent: FindArticleContent = async () => ({ content: CANONICAL_HTML });
		const summarizeArticle = jest.fn<
			ReturnType<SummarizeArticle>,
			Parameters<SummarizeArticle>
		>(async () => ({
			kind: "ready",
			summary: "A real generated summary.",
			excerpt: "A real generated excerpt.",
			inputTokens: 100,
			outputTokens: 40,
			cacheHitInputTokens: 64,
			cacheMissInputTokens: 36,
		}));

		let generateSummaryHandler: Handler<SQSEvent, SQSBatchResponse>;
		let canonicalContentChangedHandler: Handler<SQSEvent, SQSBatchResponse>;

		/* The routing dispatcher closes the event loop in-process: a
		 * publish-canonical-content-changed effect re-enters the subscriber, whose
		 * markSummaryPending emits generate-summary, which re-enters the worker.
		 * User-facing / pipeline-settling effects are intentionally not routed. */
		const dispatchEffect: DispatchEffect = async (effect) => {
			if (effect.kind === "publish-canonical-content-changed") {
				await canonicalContentChangedHandler(sqsEvent({ url: effect.url }), buildLambdaContext(), () => {});
			} else if (effect.kind === "generate-summary") {
				await generateSummaryHandler(sqsEvent({ url: effect.url }), buildLambdaContext(), () => {});
			}
		};

		const { transitionAndPersist } = initTransitionAndPersist({ store, dispatchEffect });

		generateSummaryHandler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			loadArticle: store.load,
			transitionAndPersist,
			now: () => FIXED_NOW,
			logger: noopLogger,
		});
		canonicalContentChangedHandler = initCanonicalContentChangedHandler({
			findArticleContent,
			transitionAndPersist,
			now: () => FIXED_NOW,
			logger: noopLogger,
		});

		const selectHandler = initSelectMostCompleteContentHandler({
			readCanonicalContent: async () => undefined,
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidate: "A", reason: "readable article", readability: [{ candidate: "A", readable: true }] }) } }] }) }).selectMostCompleteContent,
			writeCanonicalContent: async () => ({ contentLocation: "s3://content/current.html", candidateId: tier1.metadata.id, tier: "tier-1" }),
			resolveOriginalUrl: async () => URL,
			verifyWrapperSource: async () => undefined,
			recordCrawlVersion: jest.fn().mockResolvedValue(undefined),
			loadArticle: store.load,
			transitionAndPersist,
			now: () => FIXED_NOW,
			logger: noopLogger,
		});

		const seeded = await store.load(URL);
		expect(seeded?.summary.kind).toBe("skipped");

		await selectHandler(sqsEvent({ url: URL, tier: "tier-1", saveAttemptId: "attempt-1", candidates: [{ id: tier1.metadata.id, tier: "tier-1" }] }), buildLambdaContext(), () => {});

		const recovered = await store.load(URL);
		expect(recovered?.summary.kind).toBe("ready");
		/* Exactly one regeneration — the link-saved path is not wired here, so the
		 * only generate-summary dispatch is the one the subscriber triggered. */
		expect(summarizeArticle).toHaveBeenCalledTimes(1);
	});
});
