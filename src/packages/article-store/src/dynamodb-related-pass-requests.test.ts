import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/storage-client";
import { initDynamoDbRelatedPassRequests } from "./dynamodb-related-pass-requests";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const otherReader = UserIdSchema.parse("00000000000000000000000000000002");
const url = "https://www.Example.com/post?utm_source=x";
const normalized = "www.example.com/post";

interface CapturedSend {
	constructorName: string;
	input: Record<string, unknown>;
}

function createFakeClient(impl: (command: CapturedSend) => unknown) {
	const sends: CapturedSend[] = [];
	const fake: Partial<DynamoDBDocumentClient> = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const captured = { constructorName: command.constructor.name, input: command.input };
			sends.push(captured);
			return impl(captured);
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: fake as DynamoDBDocumentClient, sends };
}

function build(impl: (command: CapturedSend) => unknown) {
	const { client, sends } = createFakeClient(impl);
	const requests = initDynamoDbRelatedPassRequests({
		client,
		userArticlesTableName: "user-articles",
		now: () => new Date("2026-11-03T00:00:00.000Z"),
	});
	return { ...requests, sends };
}

describe("initDynamoDbRelatedPassRequests", () => {
	describe("readRelatedPassRequestState", () => {
		it("reads the reader's own row strongly consistently, keyed by the normalized URL", async () => {
			const { readRelatedPassRequestState, sends } = build(() => ({}));

			await readRelatedPassRequestState({ userId, url });
			await readRelatedPassRequestState({ userId: otherReader, url });

			expect(sends.map((send) => send.input)).toEqual([
				expect.objectContaining({
					TableName: "user-articles",
					Key: { userId, url: normalized },
					ConsistentRead: true,
				}),
				expect.objectContaining({ Key: { userId: otherReader, url: normalized } }),
			]);
		});

		it("reports an absent row as not saved", async () => {
			const { readRelatedPassRequestState } = build(() => ({}));

			expect(await readRelatedPassRequestState({ userId, url })).toEqual({ saved: false });
		});

		it("reports a row without any related attribute as saved with nothing known", async () => {
			const { readRelatedPassRequestState } = build(() => ({
				Item: { userId, url: normalized, savedAt: "2026-10-01T00:00:00.000Z" },
			}));

			expect(await readRelatedPassRequestState({ userId, url })).toEqual({ saved: true });
		});

		it("reports Past reads computed with no Next read result", async () => {
			const { readRelatedPassRequestState } = build(() => ({
				Item: {
					userId,
					url: normalized,
					savedAt: "2026-10-01T00:00:00.000Z",
					pastReadsComputedAt: "2026-10-03T00:00:00.000Z",
				},
			}));

			expect(await readRelatedPassRequestState({ userId, url })).toEqual({
				saved: true,
				pastReadsComputedAt: new Date("2026-10-03T00:00:00.000Z"),
			});
		});

		it("reports Next read ready with no displayed items as settled", async () => {
			const { readRelatedPassRequestState } = build(() => ({
				Item: {
					userId,
					url: normalized,
					savedAt: "2026-10-01T00:00:00.000Z",
					relatedStatus: "ready",
					relatedArticles: [],
				},
			}));

			expect(await readRelatedPassRequestState({ userId, url })).toEqual({
				saved: true,
				nextRead: "ready",
			});
		});

		it("returns the acknowledgement and both settled passes", async () => {
			const { readRelatedPassRequestState } = build(() => ({
				Item: {
					userId,
					url: normalized,
					savedAt: "2026-10-01T00:00:00.000Z",
					relatedPassesRequestedAt: "2026-10-02T00:00:00.000Z",
					relatedStatus: "skipped",
					pastReadsComputedAt: "2026-10-03T00:00:00.000Z",
				},
			}));

			expect(await readRelatedPassRequestState({ userId, url })).toEqual({
				saved: true,
				requestedAt: new Date("2026-10-02T00:00:00.000Z"),
				nextRead: "skipped",
				pastReadsComputedAt: new Date("2026-10-03T00:00:00.000Z"),
			});
		});
	});

	describe("markRelatedPassesRequested", () => {
		it("stamps only the acknowledgement, first write wins, on an existing row", async () => {
			const { markRelatedPassesRequested, sends } = build(() => ({}));

			const outcome = await markRelatedPassesRequested({ userId, url });

			expect(outcome).toBe("marked");
			const [send] = sends;
			expect(send?.constructorName).toBe("UpdateCommand");
			expect(send?.input).toEqual(
				expect.objectContaining({
					TableName: "user-articles",
					Key: { userId, url: normalized },
					UpdateExpression:
						"SET relatedPassesRequestedAt = if_not_exists(relatedPassesRequestedAt, :at)",
					ConditionExpression: "attribute_exists(savedAt)",
					ExpressionAttributeValues: { ":at": "2026-11-03T00:00:00.000Z" },
				}),
			);
		});

		it("reports a row deleted before the write without recreating it", async () => {
			const { markRelatedPassesRequested } = build(() => {
				throw new ConditionalCheckFailedException({ message: "no row", $metadata: {} });
			});

			expect(await markRelatedPassesRequested({ userId, url })).toBe("row-absent");
		});

		it("propagates any other failure", async () => {
			const { markRelatedPassesRequested } = build(() => {
				throw new Error("throttled");
			});

			await expect(markRelatedPassesRequested({ userId, url })).rejects.toThrow("throttled");
		});
	});
});
