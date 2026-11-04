import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ANONYMOUS_VIEWER, viewerFor } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGeneratedSummary } from "./dynamodb-generated-summary";

type SendFn = DynamoDBDocumentClient["send"];

const FROZEN_NOW = new Date("2026-09-23T00:00:00.000Z");
const now = () => FROZEN_NOW;

function createSendingClient(
	impl: (input: unknown) => unknown,
): DynamoDBDocumentClient {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	} as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
}

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const privateRow = {
	url: ArticleResourceUniqueId.parse(PRIVATE_URL).value,
	summaryStatus: "ready",
	summary: "Private chapter summary",
	ownerUserId: OWNER,
};

const createFakeClient = (
	item: Record<string, unknown> | undefined,
): DynamoDBDocumentClient => createSendingClient(() => ({ Item: item }));

describe("initDynamoDbGeneratedSummary", () => {
	it("returns undefined when no row exists", async () => {
		const client = createFakeClient(undefined);
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toBeUndefined();
	});

	it("returns undefined for a legacy row that has neither summaryStatus nor summary", async () => {
		// Legacy rows pre-date the summary state machine. The summaryStatus column
		// is absent and no backfilled summary column exists. Return undefined so
		// the caller can distinguish a stuck stub from an actively-pending row and
		// re-prime the pipeline rather than polling forever.
		const client = createFakeClient({ url: "https://example.com/article" });
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toBeUndefined();
	});

	it("returns ready for a legacy row with summary and no status (backfill)", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Legacy summary",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "ready", summary: "Legacy summary" });
	});

	it("returns ready with summary only when summaryExcerpt is absent", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Fresh summary",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "ready", summary: "Fresh summary" });
	});

	it("withholds a summary from unverified wrapper content", async () => {
		const client = createFakeClient({
			url: "example.com/article",
			summary: "Unverified wrapper summary",
			summaryExcerpt: "Unverified wrapper excerpt",
			summaryStatus: "ready",
			originalUrl: "https://archive.ph/abc12",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

		expect(await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).toBeUndefined();
	});

	it("allows a rebuilt summary while retaining the legacy wrapper identity", async () => {
		const archiveUrl = "https://archive.ph/abc12";
		const client = createFakeClient({
			url: "archive.ph/abc12",
			originalUrl: archiveUrl,
			displayUrl: "https://example.com/article",
			contentSourceUrl: archiveUrl,
			contentSourceTier: "tier-2",
			canonicalContentHash: "verified-hash", summarySourceContentHash: "verified-hash",
			canonicalCandidateId: "rebuilt-candidate",
			canonicalOriginalUrl: "https://example.com/article",
			summaryStatus: "ready",
			summary: "Verified article summary",
			summaryExcerpt: "Verified article excerpt",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

		expect(await findGeneratedSummary({ url: archiveUrl, viewer: ANONYMOUS_VIEWER })).toEqual({
			status: "ready",
			summary: "Verified article summary",
			excerpt: "Verified article excerpt",
		});
	});

	it("throws when summaryStatus=ready is persisted without summary text (data inconsistency)", async () => {
		// Why this matters: this is the exact state the
		// fagnerbrack.com/why-developers-become-frustrated-… row was left in
		// after the 2026-05-10 freshness refresh ran an UpdateExpression that
		// REMOVEd `summary` without resetting `summaryStatus`. With the previous
		// code path the mapper silently returned undefined, the reader UI
		// rendered "Generating summary…" and polled `/view/summary` every 3s
		// forever. The explicit assert turns that silent stuck-pending state
		// into a loud 500 the moment any future writer reintroduces the same
		// inconsistency, and keeps the consumer honest about the writer
		// contract: status=ready ⇒ summary text MUST be present.
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		await expect(findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).rejects.toThrow(
			"summaryStatus=ready row must carry a summary",
		);
	});

	it("returns ready with both summary and excerpt when summaryExcerpt is present", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summary: "Fresh summary",
			summaryExcerpt: "Decision-helper blurb",
			summaryStatus: "ready",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({
			status: "ready",
			summary: "Fresh summary",
			excerpt: "Decision-helper blurb",
		});
	});

	it("returns pending when status=pending", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "pending",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "pending" });
	});

	it("returns pending with stage when summaryStage is recorded", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "pending",
			summaryStage: "summary-generating",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "pending", stage: "summary-generating" });
	});

	it("returns failed with reason when status=failed", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "failed",
			summaryFailureReason: "deepseek timeout",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "failed", reason: "deepseek timeout" });
	});

	it("throws when summaryStatus=failed is persisted without a summaryFailureReason", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "failed",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		await expect(findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).rejects.toThrow(
			"summaryStatus=failed row must carry a summaryFailureReason",
		);
	});

	it("returns skipped without reason when status=skipped and no reason persisted", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "skipped",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "skipped" });
	});

	it("returns skipped with reason when summarySkippedReason is present", async () => {
		const client = createFakeClient({
			url: "https://example.com/article",
			summaryStatus: "skipped",
			summarySkippedReason: "content-too-short",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "skipped", reason: "content-too-short" });
	});

	it("skips the summary of a webmail page even when its row holds a ready one", async () => {
		const client = createFakeClient({
			url: "mail.google.com/mail/u/2/",
			summaryStatus: "ready",
			summary: "Private inbox summary",
			summaryExcerpt: "Private excerpt",
		});
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({
			client,
			tableName: "test-table",
			now,
		});

		const result = await findGeneratedSummary({ url: "https://mail.google.com/mail/u/2/", viewer: ANONYMOUS_VIEWER });

		expect(result).toEqual({ status: "skipped" });
	});

	it("shows a private upload's summary to its owner", async () => {
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({ client: createFakeClient(privateRow), tableName: "test-table", now });

		const result = await findGeneratedSummary({ url: PRIVATE_URL, viewer: viewerFor(OWNER) });

		expect(result).toEqual({ status: "ready", summary: "Private chapter summary" });
	});

	it("skips a private upload's summary for another reader", async () => {
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({ client: createFakeClient(privateRow), tableName: "test-table", now });

		const result = await findGeneratedSummary({
			url: PRIVATE_URL,
			viewer: viewerFor(UserIdSchema.parse("other-reader")),
		});

		expect(result).toEqual({ status: "skipped" });
	});

	describe("findGeneratedSummaries (batch)", () => {
		interface BatchRequest {
			Keys: { url: string }[];
			ConsistentRead?: boolean;
			ProjectionExpression?: string;
			ExpressionAttributeNames?: Record<string, string>;
		}
		interface Captured {
			commands: { input: { RequestItems?: Record<string, BatchRequest> } }[];
		}

		function batchClient(
			rows: Record<string, unknown>[],
			captured: Captured,
		): DynamoDBDocumentClient {
			return createSendingClient((input) => {
				const command = input as Captured["commands"][number];
				captured.commands.push(command);
				const tableName = Object.keys(command.input.RequestItems ?? {})[0] ?? "test-table";
				return { Responses: { [tableName]: rows }, UnprocessedKeys: {} };
			});
		}

		function requestFor(captured: Captured): BatchRequest {
			const req = captured.commands[0]?.input.RequestItems?.["test-table"];
			assert(req, "a BatchGet must have been issued against test-table");
			return req;
		}

		it("issues one BatchGet with normalized, deduped keys and a projection that excludes content", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[{ url: "example.com/a", summaryStatus: "ready", summary: "A" }],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: [
				"https://example.com/a",
				"https://example.com/a#heading", // strips to the same table key
			], viewer: ANONYMOUS_VIEWER });

			expect(captured.commands).toHaveLength(1);
			const req = requestFor(captured);
			expect(req.Keys).toEqual([{ url: "example.com/a" }]);
			expect(req.ConsistentRead).toBe(true);
			const projectedNames = Object.values(req.ExpressionAttributeNames ?? {});
			expect([...projectedNames].sort()).toEqual([
				"canonicalCandidateId", "canonicalContentHash", "canonicalOriginalUrl", "contentSourceTier",
				"contentSourceUrl", "directContentBeforePin", "displayUrl", "originalUrl", "ownerUserId", "revokedCandidateIds",
				"summary", "summaryExcerpt", "summaryFailureReason", "summarySkippedReason",
				"summarySourceContentHash", "summaryStage", "summaryStatus", "url",
			].sort());
			expect(map.get("https://example.com/a")).toEqual({ status: "ready", summary: "A" });
			expect(map.get("https://example.com/a#heading")).toEqual({ status: "ready", summary: "A" });
		});

		it("withholds unverified archive summaries alongside verified rebuilt and ordinary summaries", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient([
				{
					url: "example.com/unverified", contentSourceUrl: "https://archive.ph/abc12",
					summaryStatus: "ready", summary: "Unverified archive summary",
				},
				{
					url: "archive.ph/verified", originalUrl: "https://archive.ph/verified", contentSourceTier: "tier-2",
					canonicalCandidateId: "rebuilt-candidate", canonicalOriginalUrl: "https://example.com/verified", canonicalContentHash: "verified-hash", summarySourceContentHash: "verified-hash",
					displayUrl: "https://example.com/verified",
					summaryStatus: "ready", summary: "Verified article summary",
				},
				{ url: "example.com/direct", summary: "Ordinary legacy summary" },
			], captured);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const result = await findGeneratedSummaries({ urls: [
				"https://example.com/unverified", "https://archive.ph/verified", "https://example.com/direct",
			], viewer: ANONYMOUS_VIEWER });

			expect(result.get("https://example.com/unverified")).toBeUndefined();
			expect(result.get("https://archive.ph/verified")).toEqual({ status: "ready", summary: "Verified article summary" });
			expect(result.get("https://example.com/direct")).toEqual({ status: "ready", summary: "Ordinary legacy summary" });
		});

		it("keys every input url, mapping a missing row to undefined", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[{ url: "example.com/present", summaryStatus: "ready", summary: "Here" }],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: [
				"https://example.com/present",
				"https://example.com/absent",
			], viewer: ANONYMOUS_VIEWER });

			expect(map.has("https://example.com/absent")).toBe(true);
			expect(map.get("https://example.com/absent")).toBeUndefined();
			expect(map.get("https://example.com/present")).toEqual({ status: "ready", summary: "Here" });
		});

		it("skips the summary of a webmail page even when its row holds a ready one", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[
					{ url: "mail.google.com/mail/u/2/", summaryStatus: "ready", summary: "Private inbox summary" },
					{ url: "example.com/present", summaryStatus: "ready", summary: "Here" },
				],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: [
				"https://mail.google.com/mail/u/2/",
				"https://example.com/present",
			], viewer: ANONYMOUS_VIEWER });

			expect(map.get("https://mail.google.com/mail/u/2/")).toEqual({ status: "skipped" });
			expect(map.get("https://example.com/present")).toEqual({ status: "ready", summary: "Here" });
		});

		it("shows a private upload's summary to its owner and skips it for a signed-out viewer", async () => {
			const client = batchClient([privateRow], { commands: [] });
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const owned = await findGeneratedSummaries({ urls: [PRIVATE_URL], viewer: viewerFor(OWNER) });
			const anonymous = await findGeneratedSummaries({ urls: [PRIVATE_URL], viewer: ANONYMOUS_VIEWER });

			expect(owned.get(PRIVATE_URL)).toEqual({ status: "ready", summary: "Private chapter summary" });
			expect(anonymous.get(PRIVATE_URL)).toEqual({ status: "skipped" });
		});

		it("degrades only the poisoned row (unknown status enum), mapping its siblings", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[
					{ url: "example.com/good", summaryStatus: "ready", summary: "Good" },
					{ url: "example.com/poison", summaryStatus: "not-a-real-status" },
				],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: [
				"https://example.com/good",
				"https://example.com/poison",
			], viewer: ANONYMOUS_VIEWER });

			expect(map.get("https://example.com/poison")).toBeUndefined();
			expect(map.get("https://example.com/good")).toEqual({ status: "ready", summary: "Good" });
		});

		it("degrades a row that trips a mapper assert (ready without summary text) without throwing the batch", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[
					{ url: "example.com/ok", summaryStatus: "ready", summary: "OK" },
					{ url: "example.com/broken", summaryStatus: "ready" },
				],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: [
				"https://example.com/ok",
				"https://example.com/broken",
			], viewer: ANONYMOUS_VIEWER });

			expect(map.get("https://example.com/broken")).toBeUndefined();
			expect(map.get("https://example.com/ok")).toEqual({ status: "ready", summary: "OK" });
		});

		it("maps an unparseable input url to undefined and never sends its key", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient(
				[{ url: "example.com/valid", summaryStatus: "pending" }],
				captured,
			);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: ["https://example.com/valid", "not a url"], viewer: ANONYMOUS_VIEWER });

			expect(map.has("not a url")).toBe(true);
			expect(map.get("not a url")).toBeUndefined();
			expect(map.get("https://example.com/valid")).toEqual({ status: "pending" });
			expect(requestFor(captured).Keys).toEqual([{ url: "example.com/valid" }]);
		});

		it("sends no request for empty input", async () => {
			const captured: Captured = { commands: [] };
			const client = batchClient([], captured);
			const { findGeneratedSummaries } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });

			const map = await findGeneratedSummaries({ urls: [], viewer: ANONYMOUS_VIEWER });

			expect(map.size).toBe(0);
			expect(captured.commands).toHaveLength(0);
		});
	});

	describe("markSummaryPending", () => {
		it("issues an UpdateItem that sets summaryStatus=pending, stamps summaryPendingSince only when absent so a re-save keeps the original pending age, and guards against ready rows", async () => {
			let received: unknown;
			const client = createSendingClient((input) => {
				received = input;
				return {};
			});
			const { markSummaryPending } = initDynamoDbGeneratedSummary({
				client,
				tableName: "test-table",
				now,
			});

			await markSummaryPending({ url: "https://example.com/article" });

			const command = received as {
				input: {
					UpdateExpression?: string;
					ConditionExpression?: string;
					ExpressionAttributeValues?: Record<string, unknown>;
				};
			};
			expect(command.input.UpdateExpression).toContain(
				"SET summaryStatus = :pending",
			);
			expect(command.input.UpdateExpression).toContain(
				"summaryPendingSince = if_not_exists(summaryPendingSince, :pendingSince)",
			);
			expect(command.input.ConditionExpression).toContain(
				"attribute_not_exists(summaryStatus) OR summaryStatus <> :ready",
			);
			expect(command.input.ExpressionAttributeValues?.[":pending"]).toBe(
				"pending",
			);
			expect(command.input.ExpressionAttributeValues?.[":pendingSince"]).toBe(
				"2026-09-23T00:00:00.000Z",
			);
			expect(command.input.ExpressionAttributeValues?.[":ready"]).toBe("ready");
		});

		it("swallows ConditionalCheckFailedException so ready rows stay ready", async () => {
			const client = createSendingClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			});
			const { markSummaryPending } = initDynamoDbGeneratedSummary({
				client,
				tableName: "test-table",
				now,
			});

			await expect(
				markSummaryPending({ url: "https://example.com/article" }),
			).resolves.toBeUndefined();
		});

		it("rethrows non-ConditionalCheck errors", async () => {
			const client = createSendingClient(() => {
				throw new Error("throttled");
			});
			const { markSummaryPending } = initDynamoDbGeneratedSummary({
				client,
				tableName: "test-table",
				now,
			});

			await expect(
				markSummaryPending({ url: "https://example.com/article" }),
			).rejects.toThrow("throttled");
		});
	});
	it.each([
		{ canonicalCandidateId: "new", canonicalContentHash: "new-hash", summarySourceContentHash: "old-hash" },
	])("withholds a summary that no longer belongs to readable canonical content: %j", async (state) => {
		const client = createFakeClient({ url: "https://example.com/article", originalUrl: "https://example.com/article", canonicalOriginalUrl: "https://example.com/article", summaryStatus: "ready", summary: "Private erased text", ...state });
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });
		expect(await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).toBeUndefined();
	});

	it("serves a ready summary stamped with a source hash on a legacy row that has no canonical hash and no candidate", async () => {
		const client = createFakeClient({ url: "https://example.com/article", originalUrl: "https://example.com/article", summaryStatus: "ready", summary: "Legacy summary", summarySourceContentHash: "legacy-hash" });
		const { findGeneratedSummary } = initDynamoDbGeneratedSummary({ client, tableName: "test-table", now });
		expect(await findGeneratedSummary({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).toEqual({ status: "ready", summary: "Legacy summary" });
	});

});
