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

/** Records commands, optionally fails the conditional update so the
 * cooldown-rejected path can be asserted, and optionally answers the follow-up
 * read with the row that holds the slot. */
function createFakeClient(opts: {
	updateError?: Error;
	heldBy?: Record<string, unknown>;
}): { client: Partial<DynamoDBDocumentClient>; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "UpdateCommand" && opts.updateError) throw opts.updateError;
			if (name === "GetCommand") return { Item: opts.heldBy };
			return {};
		}) as unknown as SendFn,
	};
	return { client, commands };
}

const COOLDOWN_HELD = new ConditionalCheckFailedException({ $metadata: {}, message: "cooldown" });

function initStore(client: Partial<DynamoDBDocumentClient>) {
	return initDynamoDbReaderReadyState({
		client: client as DynamoDBDocumentClient,
		tableName: "reader-ready-notifications",
	});
}

const USER = UserIdSchema.parse("abc123");
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MESSAGE = "msg-1";
const NOW = new Date("2026-05-30T10:00:00.000Z");

describe("initDynamoDbReaderReadyState", () => {
	describe("claimReaderReadyEmailSlot", () => {
		it("claims on the userId PK with the cooldown condition alone", async () => {
			const { client, commands } = createFakeClient({});

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(claim).toEqual({ claimed: true, redelivery: false });
			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ userId: USER });
			expect(update?.input.UpdateExpression).toContain("lastReaderReadyEmailMessageId = :messageId");
			expect(update?.input.ConditionExpression).toBe(
				"attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt < :cutoff",
			);
			const values = update?.input.ExpressionAttributeValues as Record<string, unknown>;
			expect(values[":cutoff"]).toBe("2026-05-30T04:00:00.000Z");
			expect(values[":now"]).toBe("2026-05-30T10:00:00.000Z");
			expect(values[":messageId"]).toBe(MESSAGE);
			// A won claim is decided by the write alone — no follow-up read.
			expect(commands.filter((c) => c.name === "GetCommand")).toHaveLength(0);
		});

		it("reports no claim when another message holds the slot inside its cooldown", async () => {
			const { client } = createFakeClient({
				updateError: COOLDOWN_HELD,
				heldBy: {
					userId: USER,
					lastReaderReadyEmailAt: "2026-05-30T09:58:00.000Z",
					lastReaderReadyEmailMessageId: "msg-other",
				},
			});

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(claim).toEqual({ claimed: false });
		});

		it("reports no claim for a legacy row that predates message-scoped claims", async () => {
			const { client } = createFakeClient({
				updateError: COOLDOWN_HELD,
				heldBy: { userId: USER, lastReaderReadyEmailAt: "2026-05-30T09:58:00.000Z" },
			});

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(claim).toEqual({ claimed: false });
		});

		it("reports a redelivery carrying the original claim instant when the slot is already this message's", async () => {
			const { client, commands } = createFakeClient({
				updateError: COOLDOWN_HELD,
				heldBy: {
					userId: USER,
					lastReaderReadyEmailAt: "2026-05-30T09:58:00.000Z",
					lastReaderReadyEmailMessageId: MESSAGE,
				},
			});

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(claim).toEqual({
				claimed: true,
				redelivery: true,
				claimedAt: new Date("2026-05-30T09:58:00.000Z"),
			});
			// The rejected write is the only write, so the stored instant is intact and
			// a third receive still measures against the original claim.
			expect(commands.filter((c) => c.name === "UpdateCommand")).toHaveLength(1);
			// The discriminator must observe the write that rejected the conditional; a
			// default (eventually consistent) read may still serve the pre-claim state.
			const get = commands.find((c) => c.name === "GetCommand");
			expect(get?.input.ConsistentRead).toBe(true);
		});

		it("reports no claim when the slot row vanished between the rejected write and the read", async () => {
			const { client } = createFakeClient({ updateError: COOLDOWN_HELD });

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(claim).toEqual({ claimed: false });
		});

		it("rethrows non-conditional update errors", async () => {
			const { client } = createFakeClient({ updateError: new Error("throttled") });

			await expect(
				initStore(client).claimReaderReadyEmailSlot({
					userId: USER,
					now: NOW,
					cooldownMs: COOLDOWN_MS,
					messageId: MESSAGE,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("releaseReaderReadyEmailSlot", () => {
		it("removes both slot attributes conditionally on this message's claim, so a concurrent claim is never undone", async () => {
			const { client, commands } = createFakeClient({});

			await initStore(client).releaseReaderReadyEmailSlot({
				userId: USER,
				claimedAt: NOW,
				messageId: MESSAGE,
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ userId: USER });
			expect(update?.input.UpdateExpression).toBe(
				"REMOVE lastReaderReadyEmailAt, lastReaderReadyEmailMessageId",
			);
			expect(update?.input.ConditionExpression).toBe(
				"lastReaderReadyEmailAt = :claimedAt AND lastReaderReadyEmailMessageId = :messageId",
			);
			const values = update?.input.ExpressionAttributeValues as Record<string, unknown>;
			expect(values[":claimedAt"]).toBe("2026-05-30T10:00:00.000Z");
			expect(values[":messageId"]).toBe(MESSAGE);
		});

		it("is a no-op when a concurrent claim already overwrote the slot (condition fails)", async () => {
			const { client } = createFakeClient({
				updateError: new ConditionalCheckFailedException({ $metadata: {}, message: "moved on" }),
			});

			await expect(
				initStore(client).releaseReaderReadyEmailSlot({
					userId: USER,
					claimedAt: NOW,
					messageId: MESSAGE,
				}),
			).resolves.toBeUndefined();
		});

		it("rethrows non-conditional update errors", async () => {
			const { client } = createFakeClient({ updateError: new Error("throttled") });

			await expect(
				initStore(client).releaseReaderReadyEmailSlot({
					userId: USER,
					claimedAt: NOW,
					messageId: MESSAGE,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("deleteReaderReadyState", () => {
		it("deletes the single cooldown row by the userId PK", async () => {
			const { client, commands } = createFakeClient({});

			await initStore(client).deleteReaderReadyState(USER);

			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.Key).toEqual({ userId: USER });
		});
	});
});
