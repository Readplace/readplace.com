import { noopLogger } from "@packages/hutch-logger";
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
import type { SummarizeArticle } from "../generate-summary/link-summariser";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";
import type { TierSource } from "./tier-source.types";
import type {
	Handler,
	SQSBatchResponse,
	SQSEvent,
	SQSRecordAttributes,
	Context,
} from "aws-lambda";

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

const stubContext: Context = {
	callbackWaitsForEmptyEventLoop: true,
	functionName: "test",
	functionVersion: "1",
	invokedFunctionArn: "arn:aws:lambda:ap-southeast-2:123456789:function:test",
	memoryLimitInMB: "128",
	awsRequestId: "test-request-id",
	logGroupName: "/aws/lambda/test",
	logStreamName: "test-stream",
	getRemainingTimeInMillis: () => 30000,
	done: () => {},
	fail: () => {},
	succeed: () => {},
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
	};
}

describe("summary recovery on canonical content change", () => {
	it("recovers a row stuck at skipped(content-too-short) when the tier flips to the same-hash canonical content", async () => {
		/* The winning tier-1 source's content hashes to exactly the value already
		 * recorded on the row — so contentChanged is false. Only the TIER flips. */
		const canonicalHash = computeCanonicalContentHash(CANONICAL_HTML);
		const tier1: TierSource = {
			tier: "tier-1",
			html: CANONICAL_HTML,
			metadata: {
				title: "Title",
				siteName: "example.com",
				excerpt: "x",
				wordCount: 1123,
				estimatedReadTime: 5,
			},
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
		}));

		let generateSummaryHandler: Handler<SQSEvent, SQSBatchResponse>;
		let canonicalContentChangedHandler: Handler<SQSEvent, SQSBatchResponse>;

		/* The routing dispatcher closes the event loop in-process: a
		 * publish-canonical-content-changed effect re-enters the subscriber, whose
		 * markSummaryPending emits generate-summary, which re-enters the worker.
		 * User-facing / pipeline-settling effects are intentionally not routed. */
		const dispatchEffect: DispatchEffect = async (effect) => {
			if (effect.kind === "publish-canonical-content-changed") {
				await canonicalContentChangedHandler(sqsEvent({ url: effect.url }), stubContext, () => {});
			} else if (effect.kind === "generate-summary") {
				await generateSummaryHandler(sqsEvent({ url: effect.url }), stubContext, () => {});
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
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			selectMostCompleteContent: jest.fn(),
			writeCanonicalContent: jest.fn().mockResolvedValue(undefined),
			/* Current canonical is tier-0; the winner is tier-1 → the tier flips
			 * (canonicalChanged=true) even though the readable text is identical. */
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			loadArticle: store.load,
			transitionAndPersist,
			publishEvent: jest.fn().mockResolvedValue(undefined),
			now: () => FIXED_NOW,
			logger: noopLogger,
		});

		const seeded = await store.load(URL);
		expect(seeded?.summary.kind).toBe("skipped");

		await selectHandler(sqsEvent({ url: URL, tier: "tier-1" }), stubContext, () => {});

		const recovered = await store.load(URL);
		expect(recovered?.summary.kind).toBe("ready");
		/* Exactly one regeneration — the link-saved path is not wired here, so the
		 * only generate-summary dispatch is the one the subscriber triggered. */
		expect(summarizeArticle).toHaveBeenCalledTimes(1);
	});
});
