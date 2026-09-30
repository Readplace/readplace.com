import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbReaderReadyState } from "./dynamodb-reader-ready-state";

interface CapturedCommand {
	name: string;
	input: {
		Key?: Record<string, unknown>;
		ConsistentRead?: boolean;
		UpdateExpression?: string;
		ConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
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
		send: (async (command: { constructor: { name: string }; input: CapturedCommand["input"] }) => {
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
const LISTED_URLS = ["https://example.com/newest", "https://example.com/older"];

describe("initDynamoDbReaderReadyState", () => {
	describe("claimReaderReadyEmailSlot", () => {
		it("claims on the userId PK with the cooldown condition alone", async () => {
			const { client, commands } = createFakeClient({});

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
				urls: LISTED_URLS,
			});

			expect(claim).toEqual({ claimed: true, redelivery: false });
			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ userId: USER });
			expect(update?.input.UpdateExpression).toContain("lastReaderReadyEmailMessageId = :messageId");
			expect(update?.input.ConditionExpression).toBe(
				"attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt < :cutoff",
			);
			expect(update?.input.ExpressionAttributeValues?.[":cutoff"]).toBe("2026-05-30T04:00:00.000Z");
			expect(update?.input.ExpressionAttributeValues?.[":now"]).toBe("2026-05-30T10:00:00.000Z");
			expect(update?.input.ExpressionAttributeValues?.[":messageId"]).toBe(MESSAGE);
			expect(update?.input.UpdateExpression).toContain("lastReaderReadyEmailUrls = :urls");
			expect(update?.input.ExpressionAttributeValues?.[":urls"]).toEqual(LISTED_URLS);
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
				urls: LISTED_URLS,
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
				urls: LISTED_URLS,
			});

			expect(claim).toEqual({ claimed: false });
		});

		it("reports a redelivery carrying the original claim instant and the urls that send listed when the slot is already this message's", async () => {
			const { client, commands } = createFakeClient({
				updateError: COOLDOWN_HELD,
				heldBy: {
					userId: USER,
					lastReaderReadyEmailAt: "2026-05-30T09:58:00.000Z",
					lastReaderReadyEmailMessageId: MESSAGE,
					lastReaderReadyEmailUrls: ["https://example.com/emailed"],
				},
			});

			const claim = await initStore(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: NOW,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
				urls: LISTED_URLS,
			});

			expect(claim).toEqual({
				claimed: true,
				redelivery: true,
				claimedAt: new Date("2026-05-30T09:58:00.000Z"),
				urls: ["https://example.com/emailed"],
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
				urls: LISTED_URLS,
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
					urls: LISTED_URLS,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("releaseReaderReadyEmailSlot", () => {
		it("removes the slot attributes and the listed urls conditionally on this message's claim, so a concurrent claim is never undone", async () => {
			const { client, commands } = createFakeClient({});

			await initStore(client).releaseReaderReadyEmailSlot({
				userId: USER,
				claimedAt: NOW,
				messageId: MESSAGE,
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ userId: USER });
			expect(update?.input.UpdateExpression).toBe(
				"REMOVE lastReaderReadyEmailAt, lastReaderReadyEmailMessageId, lastReaderReadyEmailUrls",
			);
			expect(update?.input.ConditionExpression).toBe(
				"lastReaderReadyEmailAt = :claimedAt AND lastReaderReadyEmailMessageId = :messageId",
			);
			expect(update?.input.ExpressionAttributeValues?.[":claimedAt"]).toBe("2026-05-30T10:00:00.000Z");
			expect(update?.input.ExpressionAttributeValues?.[":messageId"]).toBe(MESSAGE);
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

	describe("findReaderReadyEmailState", () => {
		it("reads the last send instant and its message from the userId PK without writing", async () => {
			const { client, commands } = createFakeClient({
				heldBy: {
					userId: USER,
					lastReaderReadyEmailAt: "2026-05-30T09:58:00.000Z",
					lastReaderReadyEmailMessageId: MESSAGE,
				},
			});

			const state = await initStore(client).findReaderReadyEmailState(USER);

			expect(state).toEqual({
				lastSentAt: new Date("2026-05-30T09:58:00.000Z"),
				lastMessageId: MESSAGE,
			});
			expect(commands.map((c) => c.name)).toEqual(["GetCommand"]);
			expect(commands[0]?.input.Key).toEqual({ userId: USER });
		});

		it("reads as never sent when the user has no row", async () => {
			const { client } = createFakeClient({});

			const state = await initStore(client).findReaderReadyEmailState(USER);

			expect(state).toEqual({ lastSentAt: undefined, lastMessageId: undefined });
		});

		it("reads as never sent when a release removed both slot attributes from the row", async () => {
			const { client } = createFakeClient({ heldBy: { userId: USER } });

			const state = await initStore(client).findReaderReadyEmailState(USER);

			expect(state).toEqual({ lastSentAt: undefined, lastMessageId: undefined });
		});

		it("reads a legacy row that predates message-scoped claims as sent by no known message", async () => {
			const { client } = createFakeClient({
				heldBy: { userId: USER, lastReaderReadyEmailAt: "2026-05-30T09:58:00.000Z" },
			});

			const state = await initStore(client).findReaderReadyEmailState(USER);

			expect(state).toEqual({
				lastSentAt: new Date("2026-05-30T09:58:00.000Z"),
				lastMessageId: undefined,
			});
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
