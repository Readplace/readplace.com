import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/storage-client";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ANONYMOUS_VIEWER, viewerFor } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbClaimResolutionOnView } from "./dynamodb-resolution-on-view";

type SendFn = DynamoDBDocumentClient["send"];

const FROZEN_NOW = new Date("2026-11-05T12:00:00.000Z");
const now = () => FROZEN_NOW;
const TABLE = "test-table";
const URL = "https://example.com/article";
const OWNER = UserIdSchema.parse("owner-user");

type CapturedCommand = {
	input: {
		Key?: Record<string, unknown>;
		UpdateExpression?: string;
		ConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
		ReturnValues?: string;
	};
};

function createSendingClient(
	impl: (input: CapturedCommand) => unknown,
): DynamoDBDocumentClient {
	return {
		send: (async (input: CapturedCommand) => impl(input)) as unknown as SendFn,
	} as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
}

function capturingClient(attributes: Record<string, unknown>): {
	client: DynamoDBDocumentClient;
	sent: () => CapturedCommand;
} {
	let received: CapturedCommand | undefined;
	const client = createSendingClient((input) => {
		received = input;
		return { Attributes: attributes };
	});
	return {
		client,
		sent: () => {
			assert.ok(received);
			return received;
		},
	};
}

describe("initDynamoDbClaimResolutionOnView", () => {
	it("claims crawl-and-summary on a failed or unsupported crawl, setting both axes pending and clearing their reasons and the deferred marker", async () => {
		const { client, sent } = capturingClient({
			url: ArticleResourceUniqueId.parse(URL).value,
			crawlStatus: "pending",
			crawlPendingSince: FROZEN_NOW.toISOString(),
			summaryStatus: "pending",
			resolutionOnViewClaimedAt: FROZEN_NOW.toISOString(),
		});
		const claim = initDynamoDbClaimResolutionOnView({ client, tableName: TABLE, now });

		const result = await claim({ url: URL, axes: "crawl-and-summary", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({
			kind: "claimed",
			crawl: { status: "pending", startedAt: FROZEN_NOW.toISOString(), resolutionOnViewClaimedAt: FROZEN_NOW.toISOString() },
			summary: { status: "pending" },
		});
		const { input } = sent();
		expect(input.Key).toEqual({ url: ArticleResourceUniqueId.parse(URL).value });
		expect(input.UpdateExpression).toContain("SET crawlStatus = :pending, crawlPendingSince = :now, summaryStatus = :pending, summaryPendingSince = :now");
		expect(input.UpdateExpression).toContain("REMOVE crawlFailureReason, crawlUnsupportedReason, crawlStartedAt, summaryFailureReason, summarySkippedReason, meteredLegsDeferredSince");
		expect(input.UpdateExpression).toContain("resolutionOnViewClaimedAt = :now");
		expect(input.ConditionExpression).toContain("crawlStatus IN (:failed, :unsupported)");
		expect(input.ConditionExpression).toContain("attribute_not_exists(resolutionOnViewClaimedAt) OR resolutionOnViewClaimedAt < :coolDownCutoff");
		expect(input.ReturnValues).toBe("ALL_NEW");
		expect(input.ExpressionAttributeValues).toEqual({
			":pending": "pending",
			":now": FROZEN_NOW.toISOString(),
			":coolDownCutoff": "2026-11-04T12:00:00.000Z",
			":failed": "failed",
			":unsupported": "unsupported",
		});
	});

	it("claims the summary of a ready crawl whose summary failed or was skipped awaiting the reader or for an unavailable AI", async () => {
		const { client, sent } = capturingClient({
			url: ArticleResourceUniqueId.parse(URL).value,
			crawlStatus: "ready",
			summaryStatus: "pending",
			resolutionOnViewClaimedAt: FROZEN_NOW.toISOString(),
		});
		const claim = initDynamoDbClaimResolutionOnView({ client, tableName: TABLE, now });

		const result = await claim({ url: URL, axes: "summary", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({
			kind: "claimed",
			crawl: { status: "ready", resolutionOnViewClaimedAt: FROZEN_NOW.toISOString() },
			summary: { status: "pending" },
		});
		const { input } = sent();
		expect(input.UpdateExpression).toContain("SET summaryStatus = :pending, summaryPendingSince = :now");
		expect(input.UpdateExpression).toContain("REMOVE summaryFailureReason, summarySkippedReason, meteredLegsDeferredSince");
		expect(input.UpdateExpression).toContain("resolutionOnViewClaimedAt = :now");
		expect(input.ConditionExpression).toContain(
			"crawlStatus = :ready AND (summaryStatus = :failed OR (summaryStatus = :skipped AND summarySkippedReason IN (:awaitingReader, :aiUnavailable)))",
		);
		expect(input.ConditionExpression).toContain("attribute_not_exists(resolutionOnViewClaimedAt) OR resolutionOnViewClaimedAt < :coolDownCutoff");
		expect(input.ReturnValues).toBe("ALL_NEW");
		expect(input.ExpressionAttributeValues).toEqual({
			":pending": "pending",
			":now": FROZEN_NOW.toISOString(),
			":coolDownCutoff": "2026-11-04T12:00:00.000Z",
			":ready": "ready",
			":failed": "failed",
			":skipped": "skipped",
			":awaitingReader": "awaiting-reader",
			":aiUnavailable": "ai-unavailable",
		});
	});

	it("hands a non-owner a skipped summary for a private item it claimed", async () => {
		const privateUrl = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
		const { client } = capturingClient({
			url: ArticleResourceUniqueId.parse(privateUrl).value,
			crawlStatus: "ready",
			summaryStatus: "pending",
			ownerUserId: OWNER,
		});
		const claim = initDynamoDbClaimResolutionOnView({ client, tableName: TABLE, now });

		const asStranger = await claim({ url: privateUrl, axes: "summary", viewer: viewerFor(UserIdSchema.parse("someone-else")) });
		const asOwner = await claim({ url: privateUrl, axes: "summary", viewer: viewerFor(OWNER) });

		expect(asStranger).toEqual({ kind: "claimed", crawl: { status: "ready" }, summary: { status: "skipped" } });
		expect(asOwner).toEqual({ kind: "claimed", crawl: { status: "ready" }, summary: { status: "pending" } });
	});

	it("answers not-eligible when the row fails the claim's condition", async () => {
		const client = createSendingClient(() => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" });
		});
		const claim = initDynamoDbClaimResolutionOnView({ client, tableName: TABLE, now });

		const result = await claim({ url: URL, axes: "crawl-and-summary", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ kind: "not-eligible" });
	});

	it("propagates any other DynamoDB error", async () => {
		const client = createSendingClient(() => {
			throw new Error("throttled");
		});
		const claim = initDynamoDbClaimResolutionOnView({ client, tableName: TABLE, now });

		await expect(claim({ url: URL, axes: "summary", viewer: ANONYMOUS_VIEWER })).rejects.toThrow("throttled");
	});
});
