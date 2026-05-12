import { noopLogger } from "@packages/hutch-logger";
import {
	recrawlPromoteTier,
	recrawlTieKeptCanonical,
} from "@packages/domain/article-aggregate";
import { initRecrawlContentExtractedHandler } from "./recrawl-content-extracted-handler";
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

function createSqsEvent(detail: { url: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:recrawl-content-extracted",
			awsRegion: "ap-southeast-2",
		}],
	};
}

type HandlerDeps = Parameters<typeof initRecrawlContentExtractedHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		listAvailableTierSources: jest.fn<ReturnType<ListAvailableTierSources>, Parameters<ListAvailableTierSources>>().mockResolvedValue([]),
		selectMostCompleteContent: jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>().mockResolvedValue({ winner: "tie", reason: "" }),
		promoteTierToCanonical: jest.fn<ReturnType<PromoteTierToCanonical>, Parameters<PromoteTierToCanonical>>().mockResolvedValue(undefined),
		findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		imagesCdnBaseUrl: "https://cdn.example.cloudfront.net",
		logger: noopLogger,
		...overrides,
	};
	return { handler: initRecrawlContentExtractedHandler(deps), deps };
}

describe("initRecrawlContentExtractedHandler", () => {
	it("reports as a batch failure when no tier sources are available so SQS redelivers the record after the visibility timeout", async () => {
		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/a" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.promoteTierToCanonical).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
	});

	it("with one tier source, promotes it and dispatches the recrawlPromoteTier aggregate transition (GenerateSummary + RecrawlCompleted effects)", async () => {
		const tier1 = tierSource("tier-1");
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			promoteTierToCanonical,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, {
			url: "https://example.com/a",
			input: { winnerTier: "tier-1" },
		});
	});

	it("on a tie with an existing canonical, skips promotion and dispatches the recrawlTieKeptCanonical aggregate transition (one save flips crawl=ready AND emits the same effects)", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "equally complete" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
			promoteTierToCanonical,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(promoteTierToCanonical).not.toHaveBeenCalled();
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlTieKeptCanonical, {
			url: "https://example.com/a",
			input: undefined,
		});
	});

	it("on a tie, breaks in favour of the candidate with more CDN-host URLs even when canonical exists", async () => {
		// Regression: pre-Referer-fix canonical (tier-0, raw origin URLs) tied
		// with post-fix tier-1 (CDN URLs) — LLM said "only image URLs differ",
		// which left readers stuck on the broken hotlink-protected origin.
		const tier0 = tierSource("tier-0", { html: '<p>same body</p><img src="https://origin.example/a.png">' });
		const tier1 = tierSource("tier-1", {
			html: '<p>same body</p><img src="https://cdn.example.cloudfront.net/a.png"><img src="https://cdn.example.cloudfront.net/b.png">',
		});
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);
		const findContentSourceTier = jest.fn().mockResolvedValue("tier-0");

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "only image URLs differ" }),
			findContentSourceTier,
			promoteTierToCanonical,
			imagesCdnBaseUrl: "https://cdn.example.cloudfront.net",
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(findContentSourceTier).not.toHaveBeenCalled();
		expect(promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
	});

	it("on a tie with no canonical (recovering a stuck row), defaults to tier-1 and dispatches recrawlPromoteTier so summary generation can find content", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "identical content" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			promoteTierToCanonical,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, {
			url: "https://example.com/a",
			input: { winnerTier: "tier-1" },
		});
	});

	it("tie with no canonical and only tier-0 sources available falls back to tier-0", async () => {
		const tier0 = tierSource("tier-0");
		const tier0Alt = tierSource("tier-0", { metadata: stubMetadata({ title: "Alt" }) });
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier0Alt]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "tied tier-0 candidates" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			promoteTierToCanonical,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(promoteTierToCanonical).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/a", tier: "tier-0" }),
		);
	});

	it("with multiple sources and a definite winner, promotes the winner and dispatches recrawlPromoteTier", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const promoteTierToCanonical = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-1", reason: "more complete" }),
			promoteTierToCanonical,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(promoteTierToCanonical).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
			metadata: tier1.metadata,
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, {
			url: "https://example.com/a",
			input: { winnerTier: "tier-1" },
		});
	});
});
