import { noopLogger } from "@packages/hutch-logger";
import {
	refreshContent,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import type { Context, SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initRefreshContentExtractedHandler } from "./refresh-content-extracted-handler";
import type { TierSource, TierSourceMetadata } from "./tier-source.types";

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

const FIXED_NOW = new Date("2026-05-12T10:00:00.000Z");
const FRESHNESS = {
	etag: '"new-etag"',
	lastModified: "Sun, 10 May 2026 12:00:00 GMT",
	contentFetchedAt: "2026-05-10T12:00:00.000Z",
};

const stubMetadata = (overrides: Partial<TierSourceMetadata> = {}): TierSourceMetadata => ({
	title: "Title",
	siteName: "example.com",
	excerpt: "excerpt",
	wordCount: 100,
	estimatedReadTime: 1,
	...overrides,
});

function tierSource(tier: TierSource["tier"], overrides: Partial<TierSource> = {}): TierSource {
	return {
		tier,
		html: `<p>${tier} html</p>`,
		metadata: stubMetadata(overrides.metadata),
		...overrides,
	};
}

function createSqsEvent(detail: { url: string }): SQSEvent {
	return {
		Records: [
			{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { ...detail, ...FRESHNESS } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:refresh-content-extracted",
				awsRegion: "ap-southeast-2",
			},
		],
	};
}

type HandlerDeps = Parameters<typeof initRefreshContentExtractedHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);
	const deps: HandlerDeps = {
		listAvailableTierSources: jest.fn().mockResolvedValue([]),
		selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "" }),
		writeCanonicalContent: jest.fn().mockResolvedValue(undefined),
		findContentSourceTier: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist,
		now: () => FIXED_NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initRefreshContentExtractedHandler(deps), deps };
}

describe("initRefreshContentExtractedHandler", () => {
	it("reports as a batch failure when no tier sources are available so SQS redelivers the record", async () => {
		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/a" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("uses the only available tier when there is no selection to make", async () => {
		const tier1 = tierSource("tier-1");
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledWith(
			refreshContent,
			expect.objectContaining({
				url: "https://example.com/a",
				input: expect.objectContaining({
					metadata: expect.objectContaining({ title: "Title" }),
					freshness: FRESHNESS,
					now: FIXED_NOW.toISOString(),
				}),
			}),
		);
	});

	it("preserves the existing canonical tier when the selector calls a tie and the row already has a canonical (key invariant: refresh must not silently flip to tier-1)", async () => {
		const tier0 = tierSource("tier-0", { metadata: stubMetadata({ title: "Extension parse" }) });
		const tier1 = tierSource("tier-1", { metadata: stubMetadata({ title: "Refresh parse" }) });
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "tied" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).not.toHaveBeenCalled();
		expect(transitionAndPersist).toHaveBeenCalledWith(
			refreshContent,
			expect.objectContaining({
				input: expect.objectContaining({
					metadata: expect.objectContaining({ title: "Extension parse" }),
				}),
			}),
		);
	});

	it("promotes the winning tier and rewrites canonical content when the selector picks a different tier than the existing canonical", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1", { metadata: stubMetadata({ title: "Refresh parse" }) });
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-1", reason: "richer" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(
			refreshContent,
			expect.objectContaining({
				input: expect.objectContaining({
					metadata: expect.objectContaining({ title: "Refresh parse" }),
				}),
			}),
		);
	});

	it("defaults to tier-1 on a tie with no prior canonical (legacy stub-row recovery, mirrors the recrawl handler's fallback)", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "tied" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			writeCanonicalContent,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
		});
	});

	it("reports the record as a batch failure when transitionAndPersist throws so SQS replays the whole transition once DDB is healthy again", async () => {
		const tier1 = tierSource("tier-1");
		const transitionAndPersist: TransitionAndPersist = jest
			.fn()
			.mockRejectedValue(new Error("ddb throttled"));

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			transitionAndPersist,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/a" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
