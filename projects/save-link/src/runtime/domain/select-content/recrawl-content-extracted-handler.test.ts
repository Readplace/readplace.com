import { noopLogger } from "@packages/hutch-logger";
import {
	recrawlPromoteTier,
	recrawlTieKeptCanonical,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initRecrawlContentExtractedHandler } from "./recrawl-content-extracted-handler";
import type { ListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { WriteCanonicalContent } from "../../providers/article-store/promote-tier-to-canonical";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
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

const FIXED_NOW = new Date("2026-05-12T10:00:00.000Z");

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
	const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);
	const deps: HandlerDeps = {
		listAvailableTierSources: jest.fn<ReturnType<ListAvailableTierSources>, Parameters<ListAvailableTierSources>>().mockResolvedValue([]),
		selectMostCompleteContent: jest.fn<ReturnType<SelectMostCompleteContent>, Parameters<SelectMostCompleteContent>>().mockResolvedValue({ winner: "tie", reason: "" }),
		writeCanonicalContent: jest.fn<ReturnType<WriteCanonicalContent>, Parameters<WriteCanonicalContent>>().mockResolvedValue(undefined),
		findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue(undefined),
		transitionAndPersist,
		imagesCdnBaseUrl: "https://cdn.example.cloudfront.net",
		now: () => FIXED_NOW,
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
		expect(deps.writeCanonicalContent).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
	});

	it("with one tier source, writes canonical content and dispatches the recrawlPromoteTier aggregate transition with the refreshed metadata + freshness payload", async () => {
		const tier1 = tierSource("tier-1", {
			metadata: stubMetadata({
				title: "Refreshed",
				excerpt: "Refreshed excerpt",
				wordCount: 500,
				estimatedReadTime: 4,
				imageUrl: "https://cdn.example/img.png",
			}),
		});
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, {
			url: "https://example.com/a",
			input: {
				winnerTier: "tier-1",
				metadata: tier1.metadata,
				estimatedReadTime: tier1.metadata.estimatedReadTime,
				contentFetchedAt: FIXED_NOW.toISOString(),
				now: FIXED_NOW.toISOString(),
				canonicalContentHash: computeCanonicalContentHash(tier1.html),
			},
		});
	});

	it("computes a canonical content hash from the winner HTML and threads it through so the aggregate's hash gate can suppress redundant summary regeneration", async () => {
		const tier1 = tierSource("tier-1", { html: "<article><p>Distinctive recrawl body.</p></article>" });
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		const expectedHash = computeCanonicalContentHash(tier1.html);
		expect(transitionAndPersist).toHaveBeenCalledWith(
			recrawlPromoteTier,
			expect.objectContaining({
				input: expect.objectContaining({ canonicalContentHash: expectedHash }),
			}),
		);
		expect(expectedHash.length).toBe(64);
	});

	it("refreshes user-facing metadata (title/excerpt/wordCount/imageUrl) into the aggregate input on a recrawl — bug-fix coverage for the previously-frozen card", async () => {
		const tier1 = tierSource("tier-1", {
			metadata: stubMetadata({
				title: "Brand-new upstream title",
				excerpt: "Brand-new excerpt",
				wordCount: 1234,
				imageUrl: "https://cdn.example/new-image.png",
			}),
		});
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledWith(
			recrawlPromoteTier,
			expect.objectContaining({
				url: "https://example.com/a",
				input: expect.objectContaining({
					metadata: expect.objectContaining({
						title: "Brand-new upstream title",
						excerpt: "Brand-new excerpt",
						wordCount: 1234,
						imageUrl: "https://cdn.example/new-image.png",
					}),
				}),
			}),
		);
	});

	it("calls writeCanonicalContent BEFORE the aggregate transition so canonical S3 content exists by the time crawlStatus flips to ready", async () => {
		const tier1 = tierSource("tier-1");
		const callOrder: string[] = [];
		const writeCanonicalContent = jest.fn(async () => {
			callOrder.push("writeCanonicalContent");
		});
		const transitionAndPersist: TransitionAndPersist = jest.fn(async () => {
			callOrder.push("transitionAndPersist");
		});

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier1]),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(callOrder).toEqual(["writeCanonicalContent", "transitionAndPersist"]);
	});

	it("on a tie with an existing canonical, skips canonical write and dispatches the recrawlTieKeptCanonical aggregate transition (crawl flips to ready, summariser short-circuits on cache hit)", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "equally complete" }),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).not.toHaveBeenCalled();
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
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const findContentSourceTier = jest.fn().mockResolvedValue("tier-0");

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "only image URLs differ" }),
			findContentSourceTier,
			writeCanonicalContent,
			imagesCdnBaseUrl: "https://cdn.example.cloudfront.net",
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(findContentSourceTier).not.toHaveBeenCalled();
		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
		});
	});

	it("on a tie with no canonical (recovering a stuck row), defaults to tier-1 and dispatches recrawlPromoteTier so summary generation can find content", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "identical content" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, {
			url: "https://example.com/a",
			input: {
				winnerTier: "tier-1",
				metadata: tier1.metadata,
				estimatedReadTime: tier1.metadata.estimatedReadTime,
				contentFetchedAt: FIXED_NOW.toISOString(),
				now: FIXED_NOW.toISOString(),
				canonicalContentHash: computeCanonicalContentHash(tier1.html),
			},
		});
	});

	it("tie with no canonical and only tier-0 sources available falls back to tier-0", async () => {
		const tier0 = tierSource("tier-0");
		const tier0Alt = tierSource("tier-0", { metadata: stubMetadata({ title: "Alt" }) });
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier0Alt]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "tied tier-0 candidates" }),
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
			writeCanonicalContent,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-0",
		});
	});

	it("with multiple sources and a definite winner, writes canonical and dispatches recrawlPromoteTier", async () => {
		const tier0 = tierSource("tier-0");
		const tier1 = tierSource("tier-1");
		const writeCanonicalContent = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist: TransitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tier0, tier1]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-1", reason: "more complete" }),
			writeCanonicalContent,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: "https://example.com/a" }), stubContext, () => {});

		expect(writeCanonicalContent).toHaveBeenCalledWith({
			url: "https://example.com/a",
			tier: "tier-1",
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(recrawlPromoteTier, {
			url: "https://example.com/a",
			input: {
				winnerTier: "tier-1",
				metadata: tier1.metadata,
				estimatedReadTime: tier1.metadata.estimatedReadTime,
				contentFetchedAt: FIXED_NOW.toISOString(),
				now: FIXED_NOW.toISOString(),
				canonicalContentHash: computeCanonicalContentHash(tier1.html),
			},
		});
	});
});
