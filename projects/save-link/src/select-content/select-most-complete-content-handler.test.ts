import { noopLogger } from "@packages/hutch-logger";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import type { ListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { PromoteTierToCanonical } from "./promote-tier-to-canonical";
import type { FindContentSourceTier } from "./find-content-source-tier";
import type { TierSource, TierSourceMetadata } from "./tier-source.types";
import type { SQSEvent, SQSRecordAttributes, Context } from "aws-lambda";

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

function createSqsEvent(detail: { url: string; tier: "tier-0" | "tier-1"; userId?: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:select-most-complete-content",
			awsRegion: "ap-southeast-2",
		}],
	};
}

type HandlerDeps = Parameters<typeof initSelectMostCompleteContentHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		listAvailableTierSources: jest.fn<ReturnType<ListAvailableTierSources>, Parameters<ListAvailableTierSources>>().mockResolvedValue([]),
		selectMostCompleteContent: jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>().mockResolvedValue({ winner: "tie", reason: "" }),
		promoteTierToCanonical: jest.fn<ReturnType<PromoteTierToCanonical>, Parameters<PromoteTierToCanonical>>().mockResolvedValue(undefined),
		findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		logger: noopLogger,
		...overrides,
	};
	return { handler: initSelectMostCompleteContentHandler(deps), deps };
}

describe("initSelectMostCompleteContentHandler", () => {
	it("no sources available — reports as a batch failure so SQS redelivers the record (covers worker→S3→EventBridge→SQS races)", async () => {
		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/a", tier: "tier-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.promoteTierToCanonical).not.toHaveBeenCalled();
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});

	it("single source short-circuits the contest and promotes that tier without calling Deepseek", async () => {
		const tier1 = tierSource("tier-1");
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);
		const selectMostCompleteContent = jest.fn();
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			selectMostCompleteContent,
			promoteTierToCanonical,
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			publishEvent,
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-1", userId: "user-1" }), stubContext, () => {});

		expect(selectMostCompleteContent).not.toHaveBeenCalled();
		expect(promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
		expect(publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ detailType: "CrawlArticleCompleted" }),
		);
		expect(publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				detailType: "LinkSaved",
				detail: JSON.stringify({ url: "https://example.com/a", userId: "user-1" }),
			}),
		);
	});

	it("two sources, tier-0 wins — promotes tier-0 and emits LinkSaved with userId", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-0", reason: "tier-0 wins" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-1", userId: "user-1" }), stubContext, () => {});

		expect(deps.promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-0",
			metadata: tier0.metadata,
		});
		expect(deps.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				detailType: "LinkSaved",
				detail: JSON.stringify({ url: "https://example.com/a", userId: "user-1" }),
			}),
		);
	});

	it("two sources, tier-1 wins — promotes tier-1 and emits AnonymousLinkSaved when no userId", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-1", reason: "tier-1 wins" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-1" }), stubContext, () => {});

		expect(deps.promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
		expect(deps.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				detailType: "AnonymousLinkSaved",
				detail: JSON.stringify({ url: "https://example.com/a" }),
			}),
		);
		expect(deps.publishEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ detailType: "LinkSaved" }),
		);
	});

	it("tie with an existing canonical keeps it unchanged — emits CrawlArticleCompleted only, no LinkSaved/AnonymousLinkSaved", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "equally complete" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
			publishEvent,
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-0", userId: "user-1" }), stubContext, () => {});

		expect(deps.promoteTierToCanonical).not.toHaveBeenCalled();
		const events = publishEvent.mock.calls.map((call: [{ detailType: string }]) => call[0].detailType);
		expect(events).toEqual(["CrawlArticleCompleted"]);
	});

	it("tie with no canonical yet (first save) defaults to tier-1 and emits LinkSaved so the row never sits stuck", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "identical content" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			publishEvent,
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-1", userId: "user-1" }), stubContext, () => {});

		expect(deps.promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
		const events = publishEvent.mock.calls.map((call: [{ detailType: string }]) => call[0].detailType);
		expect(events).toEqual(["CrawlArticleCompleted", "LinkSaved"]);
	});

	it("tie with no canonical and only tier-0 available (no tier-1) defaults to tier-0", async () => {
		const tier0 = tierSource("tier-0");
		const tier0Alt = tierSource("tier-0", { metadata: stubMetadata({ title: "Alt" }) });

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier0Alt]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "tied tier-0 candidates" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-0", userId: "user-1" }), stubContext, () => {});

		expect(deps.promoteTierToCanonical).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/a", tier: "tier-0" }),
		);
	});

	it("re-selecting the same winner does not emit LinkSaved (canonical unchanged) but still emits CrawlArticleCompleted", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-0", reason: "still tier-0" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			publishEvent,
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-1", userId: "user-1" }), stubContext, () => {});

		expect(deps.promoteTierToCanonical).toHaveBeenCalled(); // metadata may have changed; safe to overwrite
		const events = publishEvent.mock.calls.map((call: [{ detailType: string }]) => call[0].detailType);
		expect(events).toEqual(["CrawlArticleCompleted"]);
	});

	it("first save (no prior canonical) on a single-tier short-circuit emits LinkSaved", async () => {
		const tier0 = tierSource("tier-0");

		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0]),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
		});

		await handler(createSqsEvent({ url: "https://example.com/a", tier: "tier-0", userId: "user-1" }), stubContext, () => {});

		expect(deps.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ detailType: "LinkSaved" }),
		);
	});

	it("single source short-circuits with the only-available-tier reason (covers the unreachable-selector path)", async () => {
		const tier1Only = tierSource("tier-1");
		const handler2 = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1Only]),
			selectMostCompleteContent: jest.fn(), // unreachable on length 1
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
		});
		await handler2.handler(createSqsEvent({ url: "https://example.com/x", tier: "tier-1" }), stubContext, () => {});
		expect(handler2.deps.selectMostCompleteContent).not.toHaveBeenCalled();
		expect(handler2.deps.promoteTierToCanonical).toHaveBeenCalledWith(
			expect.objectContaining({ tier: "tier-1" }),
		);
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure surfaces before processing)", async () => {
		const { handler } = createHandler();

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { wrong: "shape" } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:select-most-complete-content",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
