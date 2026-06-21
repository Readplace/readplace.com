import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbReaderReadyState } from "./dynamodb-reader-ready-state";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

type SendFn = DynamoDBDocumentClient["send"];

/** Records commands and optionally fails the conditional update so the
 * cooldown-rejected path can be asserted. */
function createFakeClient(opts: {
	updateError?: Error;
}): { client: Partial<DynamoDBDocumentClient>; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "UpdateCommand" && opts.updateError) throw opts.updateError;
			return {};
		}) as unknown as SendFn,
	};
	return { client, commands };
}

function initStore(client: Partial<DynamoDBDocumentClient>) {
	return initDynamoDbReaderReadyState({
		client: client as DynamoDBDocumentClient,
		tableName: "reader-ready-notifications",
	});
}

const USER = UserIdSchema.parse("abc123");
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

describe("initDynamoDbReaderReadyState", () => {
	describe("claimReaderReadyEmailSlot", () => {
		it("claims on the userId PK with the cooldown condition", async () => {
			const { client, commands } = createFakeClient({});

			const claimed = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(true);
			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ userId: USER });
			expect(update?.input.ConditionExpression).toBe(
				"attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt < :cutoff",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":cutoff"]).toBe(
				"2026-05-30T04:00:00.000Z",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":now"]).toBe(
				"2026-05-30T10:00:00.000Z",
			);
		});

		it("returns false when the conditional update fails (still inside the cooldown window)", async () => {
			const { client } = createFakeClient({
				updateError: new ConditionalCheckFailedException({ $metadata: {}, message: "cooldown" }),
			});

			const claimed = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(false);
		});

		it("rethrows non-conditional update errors", async () => {
			const { client } = createFakeClient({ updateError: new Error("throttled") });

			await expect(
				initStore(client).claimReaderReadyEmailSlot({
					userId: USER,
					now: new Date("2026-05-30T10:00:00.000Z"),
					cooldownMs: COOLDOWN_MS,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("releaseReaderReadyEmailSlot", () => {
		it("removes the slot conditionally on the claimed timestamp so a concurrent claim is never undone", async () => {
			const { client, commands } = createFakeClient({});

			await initStore(client).releaseReaderReadyEmailSlot({
				userId: USER,
				claimedAt: new Date("2026-05-30T10:00:00.000Z"),
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ userId: USER });
			expect(update?.input.UpdateExpression).toBe("REMOVE lastReaderReadyEmailAt");
			expect(update?.input.ConditionExpression).toBe("lastReaderReadyEmailAt = :claimedAt");
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":claimedAt"]).toBe(
				"2026-05-30T10:00:00.000Z",
			);
		});

		it("is a no-op when a concurrent claim already overwrote the slot (condition fails)", async () => {
			const { client } = createFakeClient({
				updateError: new ConditionalCheckFailedException({ $metadata: {}, message: "moved on" }),
			});

			await expect(
				initStore(client).releaseReaderReadyEmailSlot({
					userId: USER,
					claimedAt: new Date("2026-05-30T10:00:00.000Z"),
				}),
			).resolves.toBeUndefined();
		});

		it("rethrows non-conditional update errors", async () => {
			const { client } = createFakeClient({ updateError: new Error("throttled") });

			await expect(
				initStore(client).releaseReaderReadyEmailSlot({
					userId: USER,
					claimedAt: new Date("2026-05-30T10:00:00.000Z"),
				}),
			).rejects.toThrow("throttled");
		});
	});
});
