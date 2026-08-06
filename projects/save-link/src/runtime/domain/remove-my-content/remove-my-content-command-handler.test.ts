import { noopLogger } from "@packages/hutch-logger";
import {
	RecrawlLinkInitiatedEvent,
	ReselectAfterRemovalEvent,
} from "@packages/hutch-infra-components";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { TierSource } from "../select-content/tier-source.types";
import { initRemoveMyContentCommandHandler } from "./remove-my-content-command-handler";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: unknown): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:remove-my-content-command",
			awsRegion: "ap-southeast-2",
		}],
	};
}

function tierSource(tier: TierSource["tier"]): TierSource {
	return {
		tier,
		html: `<p>${tier} html</p>`,
		metadata: {
			title: "Title",
			siteName: "example.com",
			excerpt: "excerpt",
			wordCount: 100,
			estimatedReadTime: 1,
		},
	};
}

const FIXED_NOW = new Date("2026-07-16T10:00:00.000Z");
const URL = "https://example.com/post";

type HandlerDeps = Parameters<typeof initRemoveMyContentCommandHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		resolveAuthoredContentKeys: jest.fn().mockResolvedValue({
			objectKeys: ["content-versions/example.com%2Fpost/2026-07-10T09-41Z/content.html"],
			pruneMinuteIds: ["2026-07-10T09:41Z"],
		}),
		deleteContentObjects: jest.fn().mockResolvedValue(undefined),
		pruneCrawlVersions: jest.fn().mockResolvedValue(undefined),
		findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
		listAvailableTierSources: jest.fn().mockResolvedValue([]),
		countSaversByUrl: jest.fn().mockResolvedValue(0),
		purgeArticleContent: jest.fn().mockResolvedValue(undefined),
		tombstoneArticle: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: () => FIXED_NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initRemoveMyContentCommandHandler(deps), deps };
}

const MINUTE_ID = "2026-07-10T09:41Z";
const removalOf = (versionMinuteId: string = MINUTE_ID) =>
	createSqsEvent({ url: URL, userId: "user-1", versionMinuteId });

describe("initRemoveMyContentCommandHandler", () => {
	it("deletes the authored snapshot and prunes the log", async () => {
		const { handler, deps } = createHandler({
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		});

		const result = await handler(removalOf(), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.resolveAuthoredContentKeys).toHaveBeenCalledWith({
			url: URL,
			userId: "user-1",
			versionMinuteId: MINUTE_ID,
		});
		expect(deps.deleteContentObjects).toHaveBeenCalledWith([
			"content-versions/example.com%2Fpost/2026-07-10T09-41Z/content.html",
		]);
		expect(deps.pruneCrawlVersions).toHaveBeenCalledWith({
			url: URL,
			minuteIds: [MINUTE_ID],
		});
	});

	it("leaves a canonical whose own source survived the removal untouched", async () => {
		const { handler, deps } = createHandler({
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.countSaversByUrl).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
		expect(deps.tombstoneArticle).not.toHaveBeenCalled();
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});

	it("skips the repair entirely for a URL that has no canonical yet", async () => {
		const { handler, deps } = createHandler({
			findContentSourceTier: jest.fn().mockResolvedValue(undefined),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.listAvailableTierSources).not.toHaveBeenCalled();
		expect(deps.publishEvent).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
	});

	it("re-selects the canonical when its source is gone but another tier remains", async () => {
		const { handler, deps } = createHandler({
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.publishEvent).toHaveBeenCalledWith(ReselectAfterRemovalEvent, { url: URL });
		expect(deps.countSaversByUrl).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
		expect(deps.tombstoneArticle).not.toHaveBeenCalled();
	});

	it("re-crawls rather than purging while anyone still holds the URL — the remover included", async () => {
		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
			countSaversByUrl: jest.fn().mockResolvedValue(1),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.countSaversByUrl).toHaveBeenCalledWith(URL);
		expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlLinkInitiatedEvent, { url: URL });
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
		expect(deps.tombstoneArticle).not.toHaveBeenCalled();
	});

	it("purges every object and tombstones the row once nothing and nobody remains", async () => {
		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
			countSaversByUrl: jest.fn().mockResolvedValue(0),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.purgeArticleContent).toHaveBeenCalledWith(URL);
		expect(deps.tombstoneArticle).toHaveBeenCalledWith({ url: URL, at: FIXED_NOW });
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});

	it("still repairs on redelivery after the objects were already erased", async () => {
		const { handler, deps } = createHandler({
			resolveAuthoredContentKeys: jest.fn().mockResolvedValue({
				objectKeys: [],
				pruneMinuteIds: [],
			}),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-0"),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		});

		const result = await handler(removalOf(), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.deleteContentObjects).toHaveBeenCalledWith([]);
		expect(deps.publishEvent).toHaveBeenCalledWith(ReselectAfterRemovalEvent, { url: URL });
	});

	it("converges on redelivery once the repair has landed", async () => {
		const { handler, deps } = createHandler({
			resolveAuthoredContentKeys: jest.fn().mockResolvedValue({
				objectKeys: [],
				pruneMinuteIds: [],
			}),
			findContentSourceTier: jest.fn().mockResolvedValue("tier-1"),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.publishEvent).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
		expect(deps.tombstoneArticle).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure on invalid detail so it redelivers", async () => {
		const { handler, deps } = createHandler();

		const result = await handler(createSqsEvent({ wrong: "shape" }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.deleteContentObjects).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when a step throws (e.g. the prune's compare-and-swap lost a race)", async () => {
		const { handler } = createHandler({
			pruneCrawlVersions: jest.fn().mockRejectedValue(new Error("conditional check failed")),
		});

		const result = await handler(removalOf(), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

});
