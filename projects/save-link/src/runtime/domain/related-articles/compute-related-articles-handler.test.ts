import { UserIdSchema } from "@packages/domain/user";
import { noopLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	MarkRelatedArticlesOutcome,
	RelatedArticles,
	RelatedCandidate,
	RelatedTargetArticle,
} from "@packages/provider-contracts/related-articles";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initComputeRelatedArticlesHandler } from "./compute-related-articles-handler";
import { RelatedArticlesComputedEvent } from "./index";
import type { RelatedArticlesComputedDetail } from "./index";
import type { SelectRelatedArticles } from "./related-articles-selector";

const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const TARGET_URL = "https://example.com/target";
const NOW = new Date("2026-08-04T10:00:00.000Z");

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(body: string): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body,
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComputeRelatedArticles",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const commandEvent = createSqsEvent(
	JSON.stringify({ detail: { url: TARGET_URL, userId: USER_ID } }),
);

function crawledTarget(overrides: Partial<RelatedTargetArticle> = {}): RelatedTargetArticle {
	return {
		crawlStatus: "ready",
		title: "The target",
		siteName: "Example",
		description: "An excerpt",
		hasStubMetadata: false,
		...overrides,
	};
}

function candidates(count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_unused, index) => ({
		url: `https://example.com/earlier-${index}`,
		title: `Earlier ${index}`,
		siteName: "Example",
		description: "",
	}));
}

interface HandlerOverrides {
	existing?: RelatedArticles;
	target?: RelatedTargetArticle | undefined;
	candidates?: RelatedCandidate[];
	selectRelatedArticles?: SelectRelatedArticles;
	markOutcome?: MarkRelatedArticlesOutcome;
}

function createHandler(overrides: HandlerOverrides = {}) {
	const ready: Array<{ url: string; relatedArticles: readonly { url: string }[] }> = [];
	const skipped: Array<{ url: string; at: Date }> = [];
	const published: RelatedArticlesComputedDetail[] = [];
	const publishEvent: PublishEvent = async (_event, detail) => {
		published.push(RelatedArticlesComputedEvent.detailSchema.parse(detail));
	};

	const handler = initComputeRelatedArticlesHandler({
		findRelatedArticles: async () => overrides.existing ?? { status: "pending" },
		findRelatedTargetArticle: async () =>
			"target" in overrides ? overrides.target : crawledTarget(),
		findRelatedCandidateArticles: async () => overrides.candidates ?? candidates(150),
		selectRelatedArticles:
			overrides.selectRelatedArticles ??
			(async () => ({
				kind: "ready",
				related: [{ url: "https://example.com/earlier-0", reason: "Same argument" }],
				inputTokens: 120,
				outputTokens: 30,
			})),
		markRelatedArticlesReady: async (params) => {
			ready.push({ url: params.url, relatedArticles: params.relatedArticles });
			return overrides.markOutcome ?? "stored";
		},
		markRelatedArticlesSkipped: async (params) => {
			skipped.push({ url: params.url, at: params.at });
			return overrides.markOutcome ?? "stored";
		},
		publishEvent,
		now: () => NOW,
		logger: noopLogger,
	});

	return { handler, ready, skipped, published };
}

describe("initComputeRelatedArticlesHandler", () => {
	it("stores the selected relations and announces the outcome", async () => {
		const { handler, ready, published } = createHandler();

		const result = await handler(commandEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(ready).toEqual([
			{
				url: TARGET_URL,
				relatedArticles: [{ url: "https://example.com/earlier-0", reason: "Same argument" }],
			},
		]);
		expect(published).toEqual([
			{
				url: TARGET_URL,
				userId: USER_ID,
				outcome: "ready",
				relatedCount: 1,
				inputTokens: 120,
				outputTokens: 30,
			},
		]);
	});

	it("announces nothing when another computation had already settled the row", async () => {
		const { handler, ready, published } = createHandler({ markOutcome: "superseded" });

		const result = await handler(commandEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(ready).toHaveLength(1);
		expect(published).toEqual([]);
	});

	it("announces no skip when another computation had already settled the row", async () => {
		const { handler, skipped, published } = createHandler({
			target: crawledTarget({ crawlStatus: "failed", hasStubMetadata: true }),
			markOutcome: "superseded",
		});

		const result = await handler(commandEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(skipped).toHaveLength(1);
		expect(published).toEqual([]);
	});

	it("stores an empty result as a completed computation", async () => {
		const { handler, ready, published } = createHandler({
			selectRelatedArticles: async () => ({
				kind: "ready",
				related: [],
				inputTokens: 90,
				outputTokens: 5,
			}),
		});

		await handler(commandEvent, buildLambdaContext(), () => {});

		expect(ready).toEqual([{ url: TARGET_URL, relatedArticles: [] }]);
		expect(published[0]?.relatedCount).toBe(0);
	});

	it("leaves an already-computed row alone so a re-save never pays for a second call", async () => {
		const { handler, ready, skipped, published } = createHandler({
			existing: { status: "ready", items: [] },
		});

		await handler(commandEvent, buildLambdaContext(), () => {});

		expect({ ready, skipped, published }).toEqual({ ready: [], skipped: [], published: [] });
	});

	it("leaves a previously skipped row alone", async () => {
		const { handler, ready, skipped } = createHandler({ existing: { status: "skipped" } });

		await handler(commandEvent, buildLambdaContext(), () => {});

		expect({ ready, skipped }).toEqual({ ready: [], skipped: [] });
	});

	it("retries while the crawl is still filling in the article's metadata", async () => {
		const { handler, ready, skipped } = createHandler({
			target: crawledTarget({ crawlStatus: "pending" }),
		});

		const result = await handler(commandEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect({ ready, skipped }).toEqual({ ready: [], skipped: [] });
	});

	it("retries while the article row has not appeared yet", async () => {
		const { handler } = createHandler({ target: undefined });

		const result = await handler(commandEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("skips when the crawl gave up before writing anything to compare", async () => {
		const { handler, skipped, published } = createHandler({
			target: crawledTarget({ crawlStatus: "failed", hasStubMetadata: true }),
		});

		await handler(commandEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([{ url: TARGET_URL, at: NOW }]);
		expect(published).toEqual([
			{
				url: TARGET_URL,
				userId: USER_ID,
				outcome: "skipped",
				relatedCount: 0,
				inputTokens: 0,
				outputTokens: 0,
			},
		]);
	});

	it("skips while the reader has fewer than a hundred earlier saves to compare against", async () => {
		const { handler, skipped, published } = createHandler({ candidates: candidates(99) });

		await handler(commandEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([{ url: TARGET_URL, at: NOW }]);
		expect(published[0]?.outcome).toBe("skipped");
	});

	it("retries when the model answers with nothing readable", async () => {
		const { handler, ready } = createHandler({
			selectRelatedArticles: async () => ({ kind: "no-text-block" }),
		});

		const result = await handler(commandEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(ready).toEqual([]);
	});

	it("retries a message whose payload does not match the command", async () => {
		const { handler } = createHandler();

		const result = await handler(
			createSqsEvent(JSON.stringify({ detail: { url: TARGET_URL } })),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
