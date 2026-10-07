import { type CandidateId, CandidateIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import {
	RecrawlLinkInitiatedEvent,
	ReselectAfterRemovalEvent,
} from "@packages/hutch-infra-components";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import type { Article } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { TierSource } from "../select-content/tier-source.types";
import { initRemoveMyContentCommandHandler } from "./remove-my-content-command-handler";

const cid = (id: string) => CandidateIdSchema.parse(id);

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

function tierSource(tier: TierSource["tier"], id?: CandidateId): TierSource {
	return {
		tier,
		html: `<p>${tier} html</p>`,
		metadata: {
			title: "Title",
			siteName: "example.com",
			excerpt: "excerpt",
			wordCount: 100,
			estimatedReadTime: 1,
			id,
		},
	};
}

function legacyArticle(tier: TierSource["tier"]): Article {
	return {
		url: URL,
		metadata: { title: "Article", siteName: "example.com", excerpt: "text", wordCount: 100 },
		estimatedReadTime: 1,
		freshness: { contentFetchedAt: FIXED_NOW.toISOString(), canonicalContentHash: "hash-of-the-erased-capture" },
		crawl: { kind: "ready" },
		summary: { kind: "skipped" },
		summaryAutoHeal: { attempts: 0 },
		contentSelection: { tier },
	};
}

const FIXED_NOW = new Date("2026-07-16T10:00:00.000Z");
const URL = "https://example.com/post";
const AUTHORED_KEY = "content-versions/example.com%2Fpost/2026-07-10T09-41Z/content.html";
const LEGACY_CANONICAL_KEY = "content/example.com%2Fpost/content.html";

type HandlerDeps = Parameters<typeof initRemoveMyContentCommandHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		loadArticle: jest.fn().mockResolvedValue(legacyArticle("tier-0")),
		saveArticle: jest.fn().mockResolvedValue(undefined),
		revokeContentCandidates: async () => {},
		resolveAuthoredContentKeys: jest.fn().mockResolvedValue({
			objectKeys: ["content-versions/example.com%2Fpost/2026-07-10T09-41Z/content.html"],
			candidateIds: [], manifestKeys: [], pruneMinuteIds: ["2026-07-10T09:41Z"],
		}),
		deleteContentObjects: jest.fn().mockResolvedValue(undefined),
		pruneCrawlVersions: jest.fn().mockResolvedValue(undefined),
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
			loadArticle: jest.fn().mockResolvedValue(legacyArticle("tier-1")),
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
			loadArticle: jest.fn().mockResolvedValue(legacyArticle("tier-1")),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.countSaversByUrl).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
		expect(deps.tombstoneArticle).not.toHaveBeenCalled();
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});

	it("keeps the legacy canonical copy while the tier source it was copied from is still served", async () => {
		const deleted: string[][] = [];
		const { handler } = createHandler({
			loadArticle: jest.fn().mockResolvedValue(legacyArticle("tier-1")),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
			deleteContentObjects: async (keys) => { deleted.push(keys); },
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deleted).toEqual([[AUTHORED_KEY], []]);
	});

	it("erases the legacy canonical copy once the hash of the erased capture is forgotten", async () => {
		const steps: string[] = [];
		const { handler } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1", cid("surviving-crawl"))]),
			saveArticle: jest.fn(async () => { steps.push("hash cleared"); }),
			deleteContentObjects: async (keys) => { steps.push(`deleted ${keys.join(",")}`); },
			publishEvent: jest.fn(async () => { steps.push("published"); }),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(steps).toEqual([`deleted ${AUTHORED_KEY}`, "deleted ", "hash cleared", `deleted ${LEGACY_CANONICAL_KEY}`, "published"]);
	});

	it.each([
		{ row: "no article row", stored: undefined },
		{ row: "a row that never selected a tier", stored: { ...legacyArticle("tier-0"), contentSelection: undefined } },
	])("skips the repair entirely for a URL that has no canonical yet: $row", async ({ stored }) => {
		const { handler, deps } = createHandler({
			loadArticle: jest.fn().mockResolvedValue(stored),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.listAvailableTierSources).not.toHaveBeenCalled();
		expect(deps.publishEvent).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
	});

	it("re-selects the canonical when its source is gone but a judgeable candidate remains", async () => {
		const steps: string[] = [];
		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1", cid("surviving-crawl"))]),
			saveArticle: jest.fn(async () => { steps.push("hash cleared"); }),
			publishEvent: jest.fn(async () => { steps.push("published"); }),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(steps).toEqual(["hash cleared", "published"]);
		expect(deps.publishEvent).toHaveBeenCalledWith(ReselectAfterRemovalEvent, { url: URL });
		expect(deps.countSaversByUrl).not.toHaveBeenCalled();
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
		expect(deps.tombstoneArticle).not.toHaveBeenCalled();
	});

	it("erases a legacy tier-0 copy once a co-saver's candidate has replaced the sidecar it was copied from", async () => {
		const steps: string[] = [];
		const stored = legacyArticle("tier-0");
		const { handler, deps } = createHandler({
			loadArticle: jest.fn().mockResolvedValue(stored),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-0", cid("co-saver-capture"))]),
			saveArticle: jest.fn(async () => { steps.push("hash cleared"); }),
			deleteContentObjects: async (keys) => { steps.push(`deleted ${keys.join(",")}`); },
			publishEvent: jest.fn(async () => { steps.push("published"); }),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(steps).toEqual([`deleted ${AUTHORED_KEY}`, "deleted ", "hash cleared", `deleted ${LEGACY_CANONICAL_KEY}`, "published"]);
		expect(deps.saveArticle).toHaveBeenCalledWith({
			article: { ...stored, freshness: { contentFetchedAt: FIXED_NOW.toISOString(), canonicalContentHash: undefined } },
			writes: ["freshness"],
			selectionExpected: { snapshot: { tier: "tier-0" } },
		});
		expect(deps.publishEvent).toHaveBeenCalledWith(ReselectAfterRemovalEvent, { url: URL });
	});

	it("forgets the erased legacy capture's hash, then re-crawls when only an unjudgeable legacy source remains", async () => {
		const steps: string[] = [];
		const stored = legacyArticle("tier-0");
		const { handler, deps } = createHandler({
			loadArticle: jest.fn().mockResolvedValue(stored),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1")]),
			countSaversByUrl: jest.fn().mockResolvedValue(1),
			saveArticle: jest.fn(async () => { steps.push("hash cleared"); }),
			publishEvent: jest.fn(async () => { steps.push("published"); }),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});
		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(steps).toEqual(["hash cleared", "published", "hash cleared", "published"]);
		expect(deps.saveArticle).toHaveBeenCalledWith({
			article: { ...stored, freshness: { contentFetchedAt: FIXED_NOW.toISOString(), canonicalContentHash: undefined } },
			writes: ["freshness"],
			selectionExpected: { snapshot: { tier: "tier-0" } },
		});
		expect(deps.publishEvent).toHaveBeenCalledTimes(2);
		expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlLinkInitiatedEvent, { url: URL, saveAttemptId: expect.any(String) });
		expect(deps.purgeArticleContent).not.toHaveBeenCalled();
	});

	it("re-crawls rather than purging while anyone still holds the URL — the remover included", async () => {
		const { handler, deps } = createHandler({
			listAvailableTierSources: jest.fn().mockResolvedValue([]),
			countSaversByUrl: jest.fn().mockResolvedValue(1),
		});

		await handler(removalOf(), buildLambdaContext(), () => {});

		expect(deps.countSaversByUrl).toHaveBeenCalledWith(URL);
		expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlLinkInitiatedEvent, { url: URL, saveAttemptId: expect.any(String) });
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
				candidateIds: [], manifestKeys: [], pruneMinuteIds: [],
			}),
			listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-1", cid("surviving-crawl"))]),
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
				candidateIds: [], manifestKeys: [], pruneMinuteIds: [],
			}),
			loadArticle: jest.fn().mockResolvedValue(legacyArticle("tier-1")),
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

const article = (revoked: readonly CandidateId[] | undefined) => ({ url: URL, metadata: { title: "Article", siteName: "example.com", excerpt: "text", wordCount: 100 }, estimatedReadTime: 1, freshness: { contentFetchedAt: FIXED_NOW.toISOString() }, crawl: { kind: "ready" as const }, summary: { kind: "skipped" as const }, summaryAutoHeal: { attempts: 0 }, contentSelection: { candidateId: cid("removed"), tier: "tier-0" as const, revokedCandidateIds: revoked } });

describe("immutable authored candidate removal", () => {
	it("revokes before deletion and reselects even when another candidate occupies the same tier", async () => {
		const order: string[] = [];
		const { handler, deps } = createHandler({ resolveAuthoredContentKeys: async () => ({ objectKeys: ["owned"], pruneMinuteIds: [], candidateIds: [cid("removed")], manifestKeys: [] }), revokeContentCandidates: async ({ candidateIds }) => { expect(candidateIds).toEqual(["removed"]); order.push("revoked"); }, deleteContentObjects: async () => { order.push("deleted"); }, loadArticle: async () => article([cid("removed")]), listAvailableTierSources: async () => [tierSource("tier-0", cid("other"))] });
		await handler(removalOf(), buildLambdaContext(), () => {});
		expect(order).toEqual(["revoked", "deleted", "deleted", "deleted"]);
		expect(deps.publishEvent).toHaveBeenCalledWith(ReselectAfterRemovalEvent, { url: URL });
	});
	it("re-crawls when only an unjudgeable legacy source survives the revoked canonical candidate", async () => {
		const { handler, deps } = createHandler({
			loadArticle: async () => article([cid("removed")]),
			listAvailableTierSources: async () => [tierSource("tier-1")],
			countSaversByUrl: jest.fn().mockResolvedValue(1),
		});
		await handler(removalOf(), buildLambdaContext(), () => {});
		expect(deps.publishEvent).toHaveBeenCalledTimes(1);
		expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlLinkInitiatedEvent, { url: URL, saveAttemptId: expect.any(String) });
	});
	it("re-crawls rather than re-selecting when only a failed live response survives the revoked canonical candidate", async () => {
		const failedLive = tierSource("tier-1", cid("live-403"));
		const { handler, deps } = createHandler({
			loadArticle: async () => article([cid("removed")]),
			listAvailableTierSources: async () => [{ ...failedLive, metadata: { ...failedLive.metadata, kind: "live", httpStatus: 403 } }],
			countSaversByUrl: jest.fn().mockResolvedValue(1),
		});
		await handler(removalOf(), buildLambdaContext(), () => {});
		expect(deps.publishEvent).toHaveBeenCalledTimes(1);
		expect(deps.publishEvent).toHaveBeenCalledWith(RecrawlLinkInitiatedEvent, { url: URL, saveAttemptId: expect.any(String) });
		expect(deps.publishEvent).not.toHaveBeenCalledWith(ReselectAfterRemovalEvent, expect.anything());
	});
	it("re-selects when a successful live response survives the revoked canonical candidate", async () => {
		const live = tierSource("tier-1", cid("live-200"));
		const { handler, deps } = createHandler({
			loadArticle: async () => article([cid("removed")]),
			listAvailableTierSources: async () => [{ ...live, metadata: { ...live.metadata, kind: "live", httpStatus: 200 } }],
		});
		await handler(removalOf(), buildLambdaContext(), () => {});
		expect(deps.publishEvent).toHaveBeenCalledWith(ReselectAfterRemovalEvent, { url: URL });
	});
	it("keeps a canonical immutable candidate that was not revoked", async () => {
		const { handler, deps } = createHandler({ loadArticle: async () => article(undefined), listAvailableTierSources: jest.fn().mockResolvedValue([tierSource("tier-0")]) });
		expect(await handler(removalOf(), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
		expect(deps.listAvailableTierSources).toHaveBeenCalledWith(URL);
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});
	it("erases the unreferenced legacy canonical copy once an immutable candidate is committed, revoked or not", async () => {
		const { handler, deps } = createHandler({ loadArticle: async () => article(undefined), listAvailableTierSources: async () => [tierSource("tier-0")] });
		await handler(removalOf(), buildLambdaContext(), () => {});
		expect(deps.deleteContentObjects).toHaveBeenLastCalledWith([LEGACY_CANONICAL_KEY]);
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});
});

it("retains the deletion manifest when body deletion fails, then completes on redelivery", async () => {
	const calls: string[] = [];
	let failBody = true;
	const { handler } = createHandler({
		resolveAuthoredContentKeys: async () => ({ objectKeys: ["private.html"], manifestKeys: ["metadata.json"], candidateIds: [cid("owned")], pruneMinuteIds: [] }),
		revokeContentCandidates: async () => { calls.push("revoke"); },
		deleteContentObjects: async (keys) => { calls.push(keys.join(",")); if (keys.includes("private.html") && failBody) throw new Error("partial S3 deletion"); },
		pruneCrawlVersions: async () => { calls.push("prune"); },
		loadArticle: async () => undefined,
	});
	expect(await handler(removalOf(), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	expect(calls).toEqual(["revoke", "private.html"]);
	failBody = false; calls.length = 0;
	expect(await handler(removalOf(), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
	expect(calls).toEqual(["revoke", "private.html", "metadata.json", "prune"]);
});
