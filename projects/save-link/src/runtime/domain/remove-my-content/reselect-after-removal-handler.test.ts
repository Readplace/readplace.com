import { noopLogger } from "@packages/hutch-logger";
import { ReselectAfterRemovalEvent } from "@packages/hutch-infra-components";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { promoteTier } from "@packages/domain/article-aggregate";
import type { TierSource } from "../select-content/tier-source.types";
import { initReselectAfterRemovalHandler } from "./reselect-after-removal-handler";

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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:reselect-after-removal",
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

type SelectDeps = Parameters<typeof initReselectAfterRemovalHandler>[0]["selectDeps"];

function createHandler(overrides: Partial<SelectDeps> = {}) {
	const selectDeps: SelectDeps = {
		listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tie", reason: "" }),
		writeCanonicalContent: jest.fn().mockResolvedValue(undefined),
		findContentSourceTier: jest.fn().mockResolvedValue(undefined),
		findCanonicalContentHash: jest.fn().mockResolvedValue(undefined),
		recordCrawlVersion: jest.fn().mockResolvedValue(undefined),
		loadArticle: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: () => FIXED_NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initReselectAfterRemovalHandler({ selectDeps, logger: noopLogger }), selectDeps };
}

describe("initReselectAfterRemovalHandler", () => {
	it("promotes the surviving tier-1 source with no userId, so promoteTier emits no publish-link-saved effect at the remover", async () => {
		const { handler, selectDeps } = createHandler();

		const result = await handler(
			createSqsEvent({ url: URL }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(selectDeps.transitionAndPersist).toHaveBeenCalledWith(
			promoteTier,
			expect.objectContaining({
				input: expect.objectContaining({ tier: "tier-1", userId: undefined }),
			}),
		);
		// promoteTier gates publish-link-saved on userId being present, so an
		// undefined userId means the transition produces only the content-changed
		// and crawl-completed facts — never a saved! notification.
		const [, promoteParams] = (selectDeps.transitionAndPersist as jest.Mock).mock.calls[0];
		const { effects } = promoteTier(
			{
				url: URL,
				metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
				freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
				estimatedReadTime: 1,
				crawl: { kind: "ready" },
				summary: { kind: "skipped" },
				summaryAutoHeal: { attempts: 0 },
			},
			promoteParams.input,
		);
		expect(effects.map((effect) => effect.kind)).not.toContain("publish-link-saved");
	});

	it("passes the reselect through even when only the anonymous crawler copy remains (tie keeps a valid candidate)", async () => {
		const { handler, selectDeps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
			selectMostCompleteContent: jest.fn().mockResolvedValue({ winner: "tier-1", reason: "only" }),
		});

		await handler(createSqsEvent({ url: URL }), buildLambdaContext(), () => {});

		expect(selectDeps.writeCanonicalContent).toHaveBeenCalledWith({ url: URL, tier: "tier-1" });
	});

	it("surfaces the core's per-record batch failure (no sources → retry)", async () => {
		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
		});

		const result = await handler(createSqsEvent({ url: URL }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports a batch failure on malformed detail before reaching the core", async () => {
		const { handler, selectDeps } = createHandler();

		const result = await handler(createSqsEvent({ wrong: "shape" }), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(selectDeps.listAvailableTierSources).not.toHaveBeenCalled();
	});

	it("round-trips the published ReselectAfterRemoval shape", async () => {
		const detail = ReselectAfterRemovalEvent.detailSchema.parse({ url: URL });
		const { handler, selectDeps } = createHandler();

		await handler(createSqsEvent(detail), buildLambdaContext(), () => {});

		expect(selectDeps.listAvailableTierSources).toHaveBeenCalledWith(URL);
	});
});
