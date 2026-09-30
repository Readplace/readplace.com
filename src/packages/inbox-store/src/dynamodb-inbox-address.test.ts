import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import {
	AliasNameSchema,
	DELETED_ACCOUNT_INBOX_OWNER,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
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
		ConsistentRead?: boolean;
		IndexName?: string;
		KeyConditionExpression?: string;
		ConditionExpression?: string;
		UpdateExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExpressionAttributeNames?: Record<string, string>;
	};
}

const TABLE = "test-inbox-addresses";
const USER = UserIdSchema.parse("user-1");
const DOMAIN = "read.place";
const NAME = AliasNameSchema.parse("my-newsletter");
const NOW = new Date("2026-06-23T00:00:00.000Z");
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");

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

			const entry = await store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" });

			const puts = commands.filter((c) => c.input.Item);
			expect(puts).toHaveLength(1);
			expect(puts[0].input.ConditionExpression).toBe("attribute_not_exists(address)");
			expect(puts[0].input.Item?.address).toBe(entry.address);
			expect(puts[0].input.Item?.userId).toBe(USER);
			expect(puts[0].input.Item?.name).toBe(NAME);
			expect(puts[0].input.Item?.token).toBe(entry.token);
			expect(puts[0].input.Item?.createdAt).toBe(NOW.toISOString());
			expect(puts[0].input.Item?.purpose).toBe("user-alias");
			expect(entry.address).toMatch(/^my-newsletter-[0-9a-z]{6}@read\.place$/);
			expect(entry.name).toBe(NAME);
			expect(entry.createdAt).toBe(NOW.toISOString());
			expect(entry.disabledAt).toBeUndefined();
			expect(entry.purpose).toBe("user-alias");
			expect(puts[0].input.Item).not.toHaveProperty("readlist");
			expect(entry.readlist).toBeUndefined();
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

			const entry = await store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" });

			expect(puts).toBe(2);
			expect(entry.address).toMatch(/^my-newsletter-[0-9a-z]{6}@read\.place$/);
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

			await expect(store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" })).rejects.toThrow(
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

			await expect(store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" })).rejects.toThrow(
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

			await expect(store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" })).rejects.toThrow(
				InboxAddressLimitReachedError,
			);
			expect(commands.some((c) => c.input.Item)).toBe(false);
		});

		it("exempts an integration-minted address from the cap and persists its purpose", async () => {
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

			const entry = await store.createAddress({
				userId: USER,
				domain: DOMAIN,
				name: NAME,
				purpose: "gmail-forwarding",
			});

			const puts = commands.filter((c) => c.input.Item);
			expect(puts).toHaveLength(1);
			expect(puts[0].input.Item?.purpose).toBe("gmail-forwarding");
			expect(entry.purpose).toBe("gmail-forwarding");
		});

		it("counts Gmail-mapped inboxes toward the cap now that a named inbox consumes a slot", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					commands.push(cmd as CapturedCommand);
					if ((cmd as CapturedCommand).input.IndexName) {
						const Items = liveRows(INBOX_ADDRESS_MAX_PER_USER).map((row) => ({
							...row,
							purpose: "gmail-mapped",
						}));
						return { Items, Count: Items.length };
					}
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await expect(
				store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" }),
			).rejects.toThrow(InboxAddressLimitReachedError);

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

			const entry = await store.createAddress({ userId: USER, domain: DOMAIN, name: NAME, purpose: "user-alias" });

			expect(entry.address).toMatch(/^my-newsletter-[0-9a-z]{6}@read\.place$/);
			expect(commands.some((c) => c.input.Item)).toBe(true);
		});
	});

	describe("listAddressesByUserId", () => {
		it("queries the userId GSI and maps rows, backfilling a missing disabledAt and purpose", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {
						Items: [
							{
								address: "my-newsletter-a7b2c9@read.place",
								userId: "user-1",
								name: "my-newsletter",
								token: "a7b2c9",
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
							{
								address: "gmail-d4e5f6@read.place",
								userId: "user-1",
								name: "gmail",
								token: "d4e5f6",
								createdAt: "2026-08-24T00:00:00.000Z",
								disabledAt: null,
								purpose: "gmail-forwarding",
							},
							{
								address: "work-g7h8i9@read.place",
								userId: "user-1",
								name: "work",
								token: "g7h8i9",
								createdAt: "2026-09-20T00:00:00.000Z",
								disabledAt: null,
								readlist: "a1b2c3d4",
							},
						],
						Count: 4,
					};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			const result = await store.listAddressesByUserId(USER);

			expect(captured?.input.IndexName).toBe("userId-index");
			expect(captured?.input.KeyConditionExpression).toBe("userId = :uid");
			expect(captured?.input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
			expect(result).toHaveLength(4);
			expect(result[0].address).toBe("my-newsletter-a7b2c9@read.place");
			expect(result[0].name).toBe("my-newsletter");
			expect(result[0].disabledAt).toBeUndefined();
			expect(result[0].purpose).toBe("user-alias");
			// A legacy row predating the name column derives its label from the address.
			expect(result[1].name).toBe("in");
			expect(result[1].disabledAt).toBe("2026-06-22T00:00:00.000Z");
			expect(result[1].purpose).toBe("user-alias");
			expect(result[2].purpose).toBe("gmail-forwarding");
			expect(result[0].readlist).toBeUndefined();
			expect(result[3].readlist).toBe("a1b2c3d4");
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

	describe("setAddressReadlist", () => {
		it("routes an owned address to a readlist with an ownership-guarded SET", async () => {
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

			await store.setAddressReadlist({ userId: USER, address, readlist: WORK });

			expect(captured?.input.Key).toEqual({ address });
			expect(captured?.input.ConditionExpression).toBe("userId = :uid");
			expect(captured?.input.UpdateExpression).toBe("SET readlist = :readlist");
			expect(captured?.input.ExpressionAttributeValues).toEqual({ ":uid": USER, ":readlist": WORK });
		});

		it("sends an owned address back to All with an ownership-guarded REMOVE", async () => {
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

			await store.setAddressReadlist({ userId: USER, address, readlist: undefined });

			expect(captured?.input.ConditionExpression).toBe("userId = :uid");
			expect(captured?.input.UpdateExpression).toBe("REMOVE readlist");
			expect(captured?.input.ExpressionAttributeValues).toEqual({ ":uid": USER });
		});

		it("propagates the conditional-check failure when the caller does not own the row", async () => {
			const store = initDynamoDbInboxAddress({
				client: createFakeClient(() => {
					throw conditionalCheckFailed();
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await expect(
				store.setAddressReadlist({
					userId: USER,
					address: InboxAddressSchema.parse("in-3f9a2c@read.place"),
					readlist: WORK,
				}),
			).rejects.toBeInstanceOf(ConditionalCheckFailedException);
		});
	});

	describe("clearReadlistFromAddresses", () => {
		function ownedRows(): Record<string, unknown>[] {
			return [
				{
					address: "news-aaaaaa@read.place",
					userId: "user-1",
					name: "news",
					token: "aaaaaa",
					createdAt: "2026-09-20T00:00:00.000Z",
					readlist: "a1b2c3d4",
				},
				{
					address: "news-bbbbbb@read.place",
					userId: "user-1",
					name: "news",
					token: "bbbbbb",
					createdAt: "2026-09-20T00:00:00.000Z",
					readlist: "e5f6a7b8",
				},
				{
					address: "news-cccccc@read.place",
					userId: "user-1",
					name: "news",
					token: "cccccc",
					createdAt: "2026-09-20T00:00:00.000Z",
				},
				{
					address: "news-dddddd@read.place",
					userId: "user-1",
					name: "news",
					token: "dddddd",
					createdAt: "2026-09-20T00:00:00.000Z",
					readlist: "a1b2c3d4",
				},
			];
		}

		it("removes the readlist only from the addresses routed to it, each guarded on still being routed there", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					const command = cmd as CapturedCommand;
					commands.push(command);
					if (command.input.IndexName) return { Items: ownedRows(), Count: 4 };
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await store.clearReadlistFromAddresses({ userId: USER, readlist: WORK });

			const updates = commands.filter((c) => c.input.UpdateExpression);
			expect(updates.map((u) => u.input.Key)).toEqual([
				{ address: "news-aaaaaa@read.place" },
				{ address: "news-dddddd@read.place" },
			]);
			for (const update of updates) {
				expect(update.input.UpdateExpression).toBe("REMOVE readlist");
				expect(update.input.ConditionExpression).toBe("userId = :uid AND readlist = :readlist");
				expect(update.input.ExpressionAttributeValues).toEqual({ ":uid": USER, ":readlist": WORK });
			}
		});

		it("skips an address a concurrent re-route already moved", async () => {
			const updated: unknown[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					const command = cmd as CapturedCommand;
					if (command.input.IndexName) return { Items: ownedRows(), Count: 4 };
					if (command.input.Key?.address === "news-aaaaaa@read.place") throw conditionalCheckFailed();
					updated.push(command.input.Key);
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await store.clearReadlistFromAddresses({ userId: USER, readlist: WORK });

			expect(updated).toEqual([{ address: "news-dddddd@read.place" }]);
		});

		it("rethrows errors that are not conditional-check failures", async () => {
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					if ((cmd as CapturedCommand).input.IndexName) return { Items: ownedRows(), Count: 4 };
					throw new Error("dynamo unavailable");
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await expect(
				store.clearReadlistFromAddresses({ userId: USER, readlist: WORK }),
			).rejects.toThrow("dynamo unavailable");
		});

		it("issues no update when no address is routed to the readlist", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					commands.push(cmd as CapturedCommand);
					return { Items: ownedRows(), Count: 4 };
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await store.clearReadlistFromAddresses({
				userId: USER,
				readlist: ReadlistSlugSchema.parse("ffffffff"),
			});

			expect(commands.some((c) => c.input.UpdateExpression)).toBe(false);
		});
	});

	describe("enableAddress", () => {
		it("clears disabledAt with an ownership-guarded REMOVE update", async () => {
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

			await store.enableAddress({ userId: USER, address });

			expect(captured?.input.Key).toEqual({ address });
			expect(captured?.input.ConditionExpression).toBe("userId = :uid");
			expect(captured?.input.UpdateExpression).toBe("REMOVE disabledAt");
			expect(captured?.input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
		});

		it("propagates the conditional-check failure when the caller does not own the row", async () => {
			const store = initDynamoDbInboxAddress({
				client: createFakeClient(() => {
					throw conditionalCheckFailed();
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});
			const address = InboxAddressSchema.parse("in-3f9a2c@read.place");

			await expect(store.enableAddress({ userId: USER, address })).rejects.toThrow(
				ConditionalCheckFailedException,
			);
		});
	});

	describe("findByAddress", () => {
		it("resolves an address with a strongly consistent GetItem on the address key", async () => {
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
			expect(captured?.input.ConsistentRead).toBe(true);
			assert(entry, "expected the row to be returned");
			expect(entry.userId).toBe(USER);
			expect(entry.address).toBe(address);
			// The legacy row carries no name column, so the label is derived.
			expect(entry.name).toBe("in");
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

	describe("tombstoneUserAddresses", () => {
		it("reassigns each owned address to the sentinel owner, stripping the alias and stamping disabledAt, keeping every row", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					const command = cmd as CapturedCommand;
					commands.push(command);
					if (command.input.IndexName) {
						return {
							Items: [
								{
									address: "news-aaaaaa@read.place",
									userId: "user-1",
									name: "news",
									token: "aaaaaa",
									createdAt: "2026-06-20T00:00:00.000Z",
									disabledAt: null,
								},
								{
									address: "news-bbbbbb@read.place",
									userId: "user-1",
									name: "news",
									token: "bbbbbb",
									createdAt: "2026-06-20T00:00:00.000Z",
									disabledAt: "2026-06-21T00:00:00.000Z",
								},
							],
							Count: 2,
						};
					}
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await store.tombstoneUserAddresses(USER);

			const updates = commands.filter((c) => c.input.UpdateExpression);
			expect(updates).toHaveLength(2);
			for (const update of updates) {
				expect(update.input.UpdateExpression).toBe(
					"SET userId = :tomb, disabledAt = if_not_exists(disabledAt, :now) REMOVE #name, readlist",
				);
				expect(update.input.ConditionExpression).toBe("userId = :uid");
				expect(update.input.ExpressionAttributeNames).toEqual({ "#name": "name" });
				expect(update.input.ExpressionAttributeValues?.[":tomb"]).toBe(DELETED_ACCOUNT_INBOX_OWNER);
				expect(update.input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
				expect(update.input.ExpressionAttributeValues?.[":now"]).toBe(NOW.toISOString());
			}
			expect(updates.map((u) => u.input.Key)).toEqual([
				{ address: "news-aaaaaa@read.place" },
				{ address: "news-bbbbbb@read.place" },
			]);
		});

		it("issues no update when the user owns no addresses", async () => {
			const commands: CapturedCommand[] = [];
			const store = initDynamoDbInboxAddress({
				client: createFakeClient((cmd) => {
					commands.push(cmd as CapturedCommand);
					return { Items: [], Count: 0 };
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
				now: () => NOW,
			});

			await store.tombstoneUserAddresses(USER);

			expect(commands.some((c) => c.input.UpdateExpression)).toBe(false);
		});
	});
	describe("readlist addresses", () => {
		interface SentCommand {
			name: string;
			input: {
				Item?: Record<string, unknown>;
				Key?: { address: string };
				ConsistentRead?: boolean;
				IndexName?: string;
				ConditionExpression?: string;
				UpdateExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		}

		function addressTable(options: { interrupt?: (command: SentCommand) => void } = {}) {
			const items = new Map<string, Record<string, unknown>>();
			const commands: SentCommand[] = [];
			const send = async (command: { constructor: { name: string }; input: SentCommand["input"] }) => {
				const sent = { name: command.constructor.name, input: command.input };
				commands.push(sent);
				options.interrupt?.(sent);
				const key = sent.input.Key?.address;
				switch (sent.name) {
					case "GetCommand":
						return { Item: key === undefined ? undefined : items.get(key) };
					case "PutCommand": {
						const item = sent.input.Item;
						assert(item);
						if (items.has(String(item.address))) throw conditionalCheckFailed();
						items.set(String(item.address), item);
						return {};
					}
					case "UpdateCommand": {
						assert(key);
						const row = items.get(key);
						assert(row);
						items.set(key, { ...row, disabledAt: sent.input.ExpressionAttributeValues?.[":now"] });
						return {};
					}
					case "DeleteCommand": {
						assert(key);
						if (items.get(key)?.claimedAddress !== sent.input.ExpressionAttributeValues?.[":claimed"]) {
							throw conditionalCheckFailed();
						}
						items.delete(key);
						return {};
					}
					case "QueryCommand": {
						const Items = [...items.values()].filter((item) => item.userId === sent.input.ExpressionAttributeValues?.[":uid"]);
						return { Items, Count: Items.length };
					}
				}
				throw new Error(`unexpected ${sent.name}`);
			};
			const client: Partial<DynamoDBDocumentClient> = { send: send as unknown as SendFn };
			const store = initDynamoDbInboxAddress({ client: client as DynamoDBDocumentClient, tableName: TABLE, now: () => NOW });
			return { items, commands, store };
		}

		it("mints one hidden, uncapped address routed to the readlist and claims it for the user and readlist", async () => {
			const { items, commands, store } = addressTable();

			const entry = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });

			expect(entry).toEqual(
				expect.objectContaining({ userId: USER, name: "gmail", purpose: "gmail-readlist", readlist: WORK, disabledAt: undefined }),
			);
			expect(entry.address).toMatch(/^gmail-[a-z0-9]+@read\.place$/);
			expect(commands.map((c) => c.name)).toEqual(["GetCommand", "PutCommand", "PutCommand"]);
			expect(commands[0].input).toEqual(
				expect.objectContaining({ Key: { address: `claim#gmail-readlist#${USER}#${WORK}` }, ConsistentRead: true }),
			);
			expect(commands[1].input.ConditionExpression).toBe("attribute_not_exists(address)");
			expect(items.get(entry.address)).toEqual(expect.objectContaining({ purpose: "gmail-readlist", readlist: WORK }));
			expect(commands[2].input).toEqual(
				expect.objectContaining({
					Item: {
						address: `claim#gmail-readlist#${USER}#${WORK}`,
						claimOwner: USER,
						claimedAddress: entry.address,
						createdAt: NOW.toISOString(),
					},
					ConditionExpression: "attribute_not_exists(address)",
				}),
			);
		});

		it("leaves the All address unrouted so its mail lands in All", async () => {
			const { items, store } = addressTable();

			const entry = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: DEFAULT_READLIST_SLUG });

			expect(entry.readlist).toBeUndefined();
			expect(Object.keys(items.get(entry.address) ?? {})).toEqual(["address", "userId", "name", "token", "createdAt", "purpose"]);
			expect(items.get(`claim#gmail-readlist#${USER}#${DEFAULT_READLIST_SLUG}`)?.claimedAddress).toBe(entry.address);
		});

		it("returns the claimed address on every later call without minting another", async () => {
			const { items, commands, store } = addressTable();
			const first = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });
			commands.length = 0;

			const again = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });

			expect(again).toEqual(first);
			expect(commands.map((c) => [c.name, c.input.ConsistentRead])).toEqual([
				["GetCommand", true],
				["GetCommand", true],
			]);
			expect(items.size).toBe(2);
		});

		it("disables its own minted address and returns the winner when a concurrent call claimed first", async () => {
			let winner: string | undefined;
			const { items, store } = addressTable({
				interrupt: (command) => {
					const claimed = command.input.Item?.claimedAddress;
					if (winner !== undefined || typeof claimed !== "string") return;
					winner = "gmail-w1nner@read.place";
					items.set(winner, { address: winner, userId: USER, name: "gmail", token: "w1nner", createdAt: NOW.toISOString(), purpose: "gmail-readlist", readlist: WORK });
					items.set(String(command.input.Item?.address), { ...command.input.Item, claimedAddress: winner });
				},
			});

			const entry = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });

			expect(entry.address).toBe("gmail-w1nner@read.place");
			const loser = [...items.values()].find((item) => item.address !== winner && item.token !== undefined);
			expect(loser).toEqual(expect.objectContaining({ purpose: "gmail-readlist", disabledAt: NOW.toISOString() }));
		});

		it("rethrows a claim failure that is not a lost race", async () => {
			const offline = new Error("offline");
			const { store } = addressTable({
				interrupt: (command) => {
					if (command.input.Item?.claimedAddress !== undefined) throw offline;
				},
			});

			await expect(store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK })).rejects.toBe(offline);
		});

		it("finds the claimed address with consistent reads, and nothing for an unclaimed readlist", async () => {
			const { store } = addressTable();
			const created = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });

			expect(await store.findReadlistAddress({ userId: USER, readlist: WORK })).toEqual(created);
			expect(await store.findReadlistAddress({ userId: USER, readlist: DEFAULT_READLIST_SLUG })).toBeUndefined();
		});

		it("retires a readlist address by disabling it and releasing its claim", async () => {
			const { items, commands, store } = addressTable();
			const created = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });
			commands.length = 0;

			expect(await store.retireReadlistAddress({ userId: USER, readlist: WORK })).toBe(created.address);

			expect(items.get(created.address)?.disabledAt).toBe(NOW.toISOString());
			expect(items.has(`claim#gmail-readlist#${USER}#${WORK}`)).toBe(false);
			const release = commands.find((c) => c.name === "DeleteCommand");
			expect(release?.input.ConditionExpression).toBe("claimedAddress = :claimed");
			const replacement = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });
			expect(replacement.address).not.toBe(created.address);
		});

		it("retires nothing when the readlist has no claimed address", async () => {
			const { commands, store } = addressTable();

			expect(await store.retireReadlistAddress({ userId: USER, readlist: WORK })).toBeUndefined();
			expect(commands.map((c) => c.name)).toEqual(["GetCommand"]);
		});

		it("rethrows a claim release failure that is not a lost race", async () => {
			const offline = new Error("offline");
			const { store } = addressTable({
				interrupt: (command) => {
					if (command.name === "DeleteCommand") throw offline;
				},
			});
			await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });

			await expect(store.retireReadlistAddress({ userId: USER, readlist: WORK })).rejects.toBe(offline);
		});

		it("releases every readlist claim the user holds from their own address rows, without scanning", async () => {
			const { items, commands, store } = addressTable();
			const work = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });
			const all = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: DEFAULT_READLIST_SLUG });
			await store.retireReadlistAddress({ userId: USER, readlist: WORK });
			const rework = await store.getOrCreateReadlistAddress({ userId: USER, domain: DOMAIN, readlist: WORK });
			items.set("in-000001@read.place", { address: "in-000001@read.place", userId: USER, token: "000001", createdAt: NOW.toISOString(), purpose: "user-alias" });
			commands.length = 0;

			await store.deleteReadlistAddressClaims(USER);

			expect([...items.keys()].filter((key) => key.startsWith("claim#"))).toEqual([]);
			expect(commands.map((c) => c.name).sort()).toEqual(["DeleteCommand", "DeleteCommand", "DeleteCommand", "QueryCommand"]);
			expect(commands.find((c) => c.name === "QueryCommand")?.input.IndexName).toBe("userId-index");
			expect(
				commands.filter((c) => c.name === "DeleteCommand").map((c) => [c.input.Key?.address, c.input.ExpressionAttributeValues?.[":claimed"]]),
			).toEqual(
				expect.arrayContaining([
					[`claim#gmail-readlist#${USER}#${WORK}`, work.address],
					[`claim#gmail-readlist#${USER}#${DEFAULT_READLIST_SLUG}`, all.address],
					[`claim#gmail-readlist#${USER}#${WORK}`, rework.address],
				]),
			);
		});
	});
});
