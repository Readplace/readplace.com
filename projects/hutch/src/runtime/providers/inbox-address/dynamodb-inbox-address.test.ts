import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import {
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbInboxAddress } from "./dynamodb-inbox-address";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

interface CapturedCommand {
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		IndexName?: string;
		KeyConditionExpression?: string;
		ConditionExpression?: string;
		UpdateExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

const TABLE = "test-inbox-addresses";
const USER = UserIdSchema.parse("user-1");
const DOMAIN = "read.place";
const NOW = new Date("2026-06-23T00:00:00.000Z");

function conditionalCheckFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
}

describe("initDynamoDbInboxAddress", () => {
	describe("createAddress", () => {
		// createAddress first reads the user's rows off the GSI to enforce the
		// per-user cap, then conditionally puts. Tests branch the fake on the query
		// (IndexName) vs the put (Item) so the cap-count read stays out of the way of
		// the put-retry assertions.
		function liveRows(count: number): Record<string, unknown>[] {
			return Array.from({ length: count }, (_, i) => {
				const token = String(i).padStart(6, "0");
				return {
					address: `in-${token}@read.place`,
					userId: USER,
					token,
					createdAt: NOW.toISOString(),
					disabledAt: null,
				};
			});
		}

		it("conditionally puts a new row guarded on address uniqueness", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					commands.push(cmd as CapturedCommand);
					if ((cmd as CapturedCommand).input.IndexName) return { Items: [], Count: 0 };
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			const entry = await store.createAddress({ userId: USER, domain: DOMAIN });

			const puts = commands.filter((c) => c.input.Item);
			expect(puts).toHaveLength(1);
			expect(puts[0].input.ConditionExpression).toBe("attribute_not_exists(address)");
			expect(puts[0].input.Item?.address).toBe(entry.address);
			expect(puts[0].input.Item?.userId).toBe(USER);
			expect(puts[0].input.Item?.token).toBe(entry.token);
			expect(puts[0].input.Item?.createdAt).toBe(NOW.toISOString());
			expect(entry.address).toMatch(/^in-[0-9a-z]{6}@read\.place$/);
			expect(entry.createdAt).toBe(NOW.toISOString());
			expect(entry.disabledAt).toBeUndefined();
		});

		it("regenerates and retries when the address collides, then succeeds", async () => {
			let puts = 0;
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					if ((cmd as CapturedCommand).input.IndexName) return { Items: [], Count: 0 };
					puts++;
					if (puts === 1) throw conditionalCheckFailed();
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			const entry = await store.createAddress({ userId: USER, domain: DOMAIN });

			expect(puts).toBe(2);
			expect(entry.address).toMatch(/^in-[0-9a-z]{6}@read\.place$/);
		});

		it("throws after exhausting retries on persistent collisions", async () => {
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					if ((cmd as CapturedCommand).input.IndexName) return { Items: [], Count: 0 };
					throw conditionalCheckFailed();
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await expect(store.createAddress({ userId: USER, domain: DOMAIN })).rejects.toThrow(
				"Failed to mint a unique inbox address",
			);
		});

		it("rethrows errors that are not conditional-check failures", async () => {
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					if ((cmd as CapturedCommand).input.IndexName) return { Items: [], Count: 0 };
					throw new Error("throttled");
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await expect(store.createAddress({ userId: USER, domain: DOMAIN })).rejects.toThrow(
				"throttled",
			);
		});

		it("throws InboxAddressLimitReachedError and issues no put once the user holds the live cap", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					commands.push(cmd as CapturedCommand);
					if ((cmd as CapturedCommand).input.IndexName) {
						const Items = liveRows(INBOX_ADDRESS_MAX_PER_USER);
						return { Items, Count: Items.length };
					}
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await expect(store.createAddress({ userId: USER, domain: DOMAIN })).rejects.toThrow(
				InboxAddressLimitReachedError,
			);
			expect(commands.some((c) => c.input.Item)).toBe(false);
		});

		it("counts only live rows toward the cap: a user whose cap-worth of rows are all disabled can still create", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					commands.push(cmd as CapturedCommand);
					if ((cmd as CapturedCommand).input.IndexName) {
						const Items = liveRows(INBOX_ADDRESS_MAX_PER_USER).map((row) => ({
							...row,
							disabledAt: "2026-06-22T00:00:00.000Z",
						}));
						return { Items, Count: Items.length };
					}
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			const entry = await store.createAddress({ userId: USER, domain: DOMAIN });

			expect(entry.address).toMatch(/^in-[0-9a-z]{6}@read\.place$/);
			expect(commands.some((c) => c.input.Item)).toBe(true);
		});
	});

	describe("listAddressesByUserId", () => {
		it("queries the userId GSI and maps rows, normalizing a missing disabledAt to undefined", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {
						Items: [
							{
								address: "in-3f9a2c@read.place",
								userId: "user-1",
								token: "3f9a2c",
								createdAt: "2026-06-20T00:00:00.000Z",
								disabledAt: null,
							},
							{
								address: "in-abc123@read.place",
								userId: "user-1",
								token: "abc123",
								createdAt: "2026-06-21T00:00:00.000Z",
								disabledAt: "2026-06-22T00:00:00.000Z",
							},
						],
						Count: 2,
					};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			const result = await store.listAddressesByUserId(USER);

			expect(captured?.input.IndexName).toBe("userId-index");
			expect(captured?.input.KeyConditionExpression).toBe("userId = :uid");
			expect(captured?.input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
			expect(result).toHaveLength(2);
			expect(result[0].address).toBe("in-3f9a2c@read.place");
			expect(result[0].disabledAt).toBeUndefined();
			expect(result[1].disabledAt).toBe("2026-06-22T00:00:00.000Z");
		});
	});

	describe("disableAddress", () => {
		it("stamps disabledAt with an ownership-guarded conditional update", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});
			const address = InboxAddressSchema.parse("in-3f9a2c@read.place");

			await store.disableAddress({ userId: USER, address });

			expect(captured?.input.Key).toEqual({ address });
			expect(captured?.input.ConditionExpression).toBe("userId = :uid");
			expect(captured?.input.UpdateExpression).toBe("SET disabledAt = :now");
			expect(captured?.input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
			expect(captured?.input.ExpressionAttributeValues?.[":now"]).toBe(
				NOW.toISOString(),
			);
		});
	});

	describe("findByAddress", () => {
		it("resolves an address with a single GetItem on the address key", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {
						Item: {
							address: "in-3f9a2c@read.place",
							userId: "user-1",
							token: "3f9a2c",
							createdAt: "2026-06-20T00:00:00.000Z",
							disabledAt: null,
						},
					};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});
			const address = InboxAddressSchema.parse("in-3f9a2c@read.place");

			const entry = await store.findByAddress(address);

			expect(captured?.input.Key).toEqual({ address });
			assert(entry, "expected the row to be returned");
			expect(entry.userId).toBe(USER);
			expect(entry.address).toBe(address);
		});

		it("returns undefined for an unknown address", async () => {
			const store = initDynamoDbInboxAddress({
				client: createFakeClient(() => ({})) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});
			const address = InboxAddressSchema.parse("in-zzzzzz@read.place");

			expect(await store.findByAddress(address)).toBeUndefined();
		});
	});
});
