import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import {
	InboxAddressSchema,
	type InboxEmailEntry,
	MessageIdSchema,
	emailImageS3KeyPrefix,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbInboxEmail } from "./dynamodb-inbox-email";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (input: unknown) => unknown): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

interface RecordedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands by SDK class name and replays a sequence of query pages,
 * each carrying its rows and the LastEvaluatedKey that drives the next page
 * (omitted on the final page). Queries past the last page replay it. */
function createPaginatedClient(
	pages: { rows: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }[],
): { client: DynamoDBDocumentClient; commands: RecordedCommand[] } {
	const commands: RecordedCommand[] = [];
	let queryCount = 0;
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") {
				const page = pages[Math.min(queryCount, pages.length - 1)];
				queryCount += 1;
				return { Items: page.rows, Count: page.rows.length, LastEvaluatedKey: page.lastEvaluatedKey };
			}
			return {};
		}) as SendFn,
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function emailRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		userId: "user-1",
		receivedAtMessageId: "2026-06-23T00:00:00.000Z#<m-1@example.com>",
		messageId: "<m-1@example.com>",
		recipientAddress: "in-3f9a2c@read.place",
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-23T00:00:00.000Z",
		rawEmailS3Key: "inbound/m-1",
		bodyS3Key: "content/m-1/content.html",
		...overrides,
	};
}

interface CapturedCommand {
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		KeyConditionExpression?: string;
		ConditionExpression?: string;
		ScanIndexForward?: boolean;
		Select?: string;
		Limit?: number;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
}

function createOrderedClient(responses: Record<string, unknown>[]): {
	client: DynamoDBDocumentClient;
	captured: CapturedCommand[];
} {
	const captured: CapturedCommand[] = [];
	let index = 0;
	const client = createFakeClient((cmd) => {
		captured.push(cmd as CapturedCommand);
		assert(index < responses.length, "ordered client received an unexpected extra query");
		return responses[index++];
	}) as DynamoDBDocumentClient;
	return { client, captured };
}

const TABLE = "test-inbox-emails";
const USER = UserIdSchema.parse("user-1");

function makeEntry(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	return {
		userId: USER,
		receivedAtMessageId: "2026-06-23T00:00:00.000Z#<m-1@example.com>",
		messageId: MessageIdSchema.parse("<m-1@example.com>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-23T00:00:00.000Z",
		rawEmailS3Key: "inbound/ses-message-1",
		bodyS3Key: "content/email%3A%2F%2Fabc/content.html",
		...overrides,
	};
}

function conditionalCheckFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
}

function rawRow(input: { hour: string; messageId: string }): Record<string, unknown> {
	return {
		userId: "user-1",
		receivedAtMessageId: `2026-06-23T${input.hour}:00:00.000Z#${input.messageId}`,
		messageId: input.messageId,
		recipientAddress: "in-3f9a2c@read.place",
		senderEmail: "news@example.com",
		subject: `At ${input.hour}`,
		status: "received",
		receivedAt: `2026-06-23T${input.hour}:00:00.000Z`,
		rawEmailS3Key: `inbound/${input.hour}`,
		bodyS3Key: `content/${input.hour}/content.html`,
	};
}

describe("initDynamoDbInboxEmail", () => {
	describe("putEmail", () => {
		it("conditionally puts a received row keyed for idempotency, including the body pointer", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxEmail({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const result = await store.putEmail(makeEntry());

			expect(result).toBe("stored");
			expect(captured?.input.ConditionExpression).toBe(
				"attribute_not_exists(receivedAtMessageId)",
			);
			expect(captured?.input.Item?.receivedAtMessageId).toBe(
				"2026-06-23T00:00:00.000Z#<m-1@example.com>",
			);
			expect(captured?.input.Item?.status).toBe("received");
			expect(captured?.input.Item?.bodyS3Key).toBe(
				"content/email%3A%2F%2Fabc/content.html",
			);
		});

		it("omits the body pointer attribute for a rejected row with no rendered body", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxEmail({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const result = await store.putEmail(
				makeEntry({ status: "rejected", bodyS3Key: undefined }),
			);

			expect(result).toBe("stored");
			expect(captured?.input.Item?.status).toBe("rejected");
			expect(captured?.input.Item).not.toHaveProperty("bodyS3Key");
		});

		it("returns duplicate when the conditional put fails on an existing row", async () => {
			const store = initDynamoDbInboxEmail({
				client: createFakeClient(() => {
					throw conditionalCheckFailed();
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			expect(await store.putEmail(makeEntry())).toBe("duplicate");
		});

		it("rethrows errors that are not conditional-check failures", async () => {
			const store = initDynamoDbInboxEmail({
				client: createFakeClient(() => {
					throw new Error("throttled");
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(store.putEmail(makeEntry())).rejects.toThrow("throttled");
		});
	});

	describe("listEmailsByUserId", () => {
		it("fetches the newest page in one descending probe query, normalizing a missing body pointer", async () => {
			const { client, captured } = createOrderedClient([
				{
					Items: [
						{
							userId: "user-1",
							receivedAtMessageId: "2026-06-23T09:00:00.000Z#<b@x>",
							messageId: "<b@x>",
							recipientAddress: "in-3f9a2c@read.place",
							senderEmail: "b@x",
							subject: "Newer",
							status: "received",
							receivedAt: "2026-06-23T09:00:00.000Z",
							rawEmailS3Key: "inbound/b",
							bodyS3Key: "content/b/content.html",
						},
						{
							userId: "user-1",
							receivedAtMessageId: "2026-06-23T08:00:00.000Z#<a@x>",
							messageId: "<a@x>",
							recipientAddress: "in-3f9a2c@read.place",
							senderEmail: "a@x",
							subject: "",
							status: "rejected",
							receivedAt: "2026-06-23T08:00:00.000Z",
							rawEmailS3Key: "inbound/a",
							bodyS3Key: null,
						},
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: undefined,
				pageSize: 20,
			});

			expect(captured).toHaveLength(1);
			expect(captured[0].input.KeyConditionExpression).toBe("userId = :uid");
			expect(captured[0].input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
			expect(captured[0].input.ScanIndexForward).toBe(false);
			expect(captured[0].input.Limit).toBe(21);
			expect(captured[0].input.Select).toBeUndefined();
			expect(captured[0].input.ExclusiveStartKey).toBeUndefined();
			expect(result.emails).toHaveLength(2);
			expect(result.hasNewer).toBe(false);
			expect(result.hasOlder).toBe(false);
			expect(result.emails[0].subject).toBe("Newer");
			expect(result.emails[0].bodyS3Key).toBe("content/b/content.html");
			expect(result.emails[1].bodyS3Key).toBeUndefined();
		});

		it("keeps only the page rows and reports older rows when the probe overflows", async () => {
			const { client, captured } = createOrderedClient([
				{
					Items: [
						rawRow({ hour: "10", messageId: "<c@x>" }),
						rawRow({ hour: "09", messageId: "<b@x>" }),
						rawRow({ hour: "08", messageId: "<a@x>" }),
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: undefined,
				pageSize: 2,
			});

			expect(captured[0].input.Limit).toBe(3);
			expect(result.emails.map((e) => e.subject)).toEqual(["At 10", "At 09"]);
			expect(result.hasOlder).toBe(true);
			expect(result.hasNewer).toBe(false);
		});

		it("starts an older page just past the cursor row and flags the newer side", async () => {
			const { client, captured } = createOrderedClient([
				{ Items: [rawRow({ hour: "08", messageId: "<a@x>" })] },
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: {
					direction: "older",
					receivedAtMessageId: "2026-06-23T09:00:00.000Z#<b@x>",
				},
				pageSize: 2,
			});

			expect(captured[0].input.ScanIndexForward).toBe(false);
			expect(captured[0].input.ExclusiveStartKey).toEqual({
				userId: USER,
				receivedAtMessageId: "2026-06-23T09:00:00.000Z#<b@x>",
			});
			expect(result.emails.map((e) => e.subject)).toEqual(["At 08"]);
			expect(result.hasNewer).toBe(true);
			expect(result.hasOlder).toBe(false);
		});

		it("walks a newer page ascending and returns it newest-first", async () => {
			const { client, captured } = createOrderedClient([
				{
					Items: [
						rawRow({ hour: "08", messageId: "<a@x>" }),
						rawRow({ hour: "09", messageId: "<b@x>" }),
						rawRow({ hour: "10", messageId: "<c@x>" }),
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: {
					direction: "newer",
					receivedAtMessageId: "2026-06-23T07:00:00.000Z#<z@x>",
				},
				pageSize: 2,
			});

			expect(captured[0].input.ScanIndexForward).toBe(true);
			expect(captured[0].input.ExclusiveStartKey).toEqual({
				userId: USER,
				receivedAtMessageId: "2026-06-23T07:00:00.000Z#<z@x>",
			});
			expect(result.emails.map((e) => e.subject)).toEqual(["At 09", "At 08"]);
			expect(result.hasNewer).toBe(true);
			expect(result.hasOlder).toBe(true);
		});

		it("reports no newer rows when the ascending probe drains the mailbox", async () => {
			const { client } = createOrderedClient([
				{ Items: [rawRow({ hour: "08", messageId: "<a@x>" })] },
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: {
					direction: "newer",
					receivedAtMessageId: "2026-06-23T07:00:00.000Z#<z@x>",
				},
				pageSize: 2,
			});

			expect(result.emails.map((e) => e.subject)).toEqual(["At 08"]);
			expect(result.hasNewer).toBe(false);
			expect(result.hasOlder).toBe(true);
		});

		it("accumulates across a 1 MB split until the probe is full", async () => {
			const splitKey = {
				userId: "user-1",
				receivedAtMessageId: "2026-06-23T10:00:00.000Z#<c@x>",
			};
			const { client, captured } = createOrderedClient([
				{ Items: [rawRow({ hour: "10", messageId: "<c@x>" })], LastEvaluatedKey: splitKey },
				{
					Items: [
						rawRow({ hour: "09", messageId: "<b@x>" }),
						rawRow({ hour: "08", messageId: "<a@x>" }),
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: undefined,
				pageSize: 2,
			});

			expect(captured).toHaveLength(2);
			expect(captured[0].input.Limit).toBe(3);
			expect(captured[1].input.Limit).toBe(2);
			expect(captured[1].input.ExclusiveStartKey).toEqual(splitKey);
			expect(result.emails.map((e) => e.subject)).toEqual(["At 10", "At 09"]);
			expect(result.hasOlder).toBe(true);
		});

		it("issues no follow-up query once the probe is full even when DynamoDB reports more", async () => {
			const { client, captured } = createOrderedClient([
				{
					Items: [
						rawRow({ hour: "10", messageId: "<c@x>" }),
						rawRow({ hour: "09", messageId: "<b@x>" }),
					],
					LastEvaluatedKey: {
						userId: "user-1",
						receivedAtMessageId: "2026-06-23T09:00:00.000Z#<b@x>",
					},
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: undefined,
				pageSize: 1,
			});

			expect(captured).toHaveLength(1);
			expect(result.emails.map((e) => e.subject)).toEqual(["At 10"]);
			expect(result.hasOlder).toBe(true);
		});

		it("returns an empty page with no neighbours for an empty mailbox", async () => {
			const { client } = createOrderedClient([{ Items: [] }]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const result = await store.listEmailsByUserId({
				userId: USER,
				cursor: undefined,
				pageSize: 20,
			});

			expect(result.emails).toEqual([]);
			expect(result.hasNewer).toBe(false);
			expect(result.hasOlder).toBe(false);
		});

		it("rejects a cursor with an empty boundary row", async () => {
			const store = initDynamoDbInboxEmail({
				client: createFakeClient(() => ({})) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			await expect(
				store.listEmailsByUserId({
					userId: USER,
					cursor: { direction: "older", receivedAtMessageId: "" },
					pageSize: 20,
				}),
			).rejects.toThrow("cursor must name a boundary row");
		});
	});

	describe("getEmail", () => {
		it("gets a single row by its composite key", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxEmail({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {
						Item: {
							userId: "user-1",
							receivedAtMessageId: "2026-06-23T00:00:00.000Z#<m-1@example.com>",
							messageId: "<m-1@example.com>",
							recipientAddress: "in-3f9a2c@read.place",
							senderEmail: "news@example.com",
							subject: "Weekly digest",
							status: "received",
							receivedAt: "2026-06-23T00:00:00.000Z",
							rawEmailS3Key: "inbound/m-1",
							bodyS3Key: "content/m-1/content.html",
						},
					};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const entry = await store.getEmail({
				userId: USER,
				receivedAtMessageId: "2026-06-23T00:00:00.000Z#<m-1@example.com>",
			});

			expect(captured?.input.Key).toEqual({
				userId: USER,
				receivedAtMessageId: "2026-06-23T00:00:00.000Z#<m-1@example.com>",
			});
			assert(entry, "expected the row to be returned");
			expect(entry.subject).toBe("Weekly digest");
		});

		it("returns undefined for an unknown row", async () => {
			const store = initDynamoDbInboxEmail({
				client: createFakeClient(() => ({})) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			expect(
				await store.getEmail({ userId: USER, receivedAtMessageId: "missing" }),
			).toBeUndefined();
		});
	});

	describe("listDeletionReferencesByUserId", () => {
		it("returns raw and body keys and message ids for the user without deleting any row", async () => {
			const { client, commands } = createPaginatedClient([
				{
					rows: [
						emailRow({
							receivedAtMessageId: "2026-06-23T09:00:00.000Z#<a@x>",
							rawEmailS3Key: "inbound/a",
							bodyS3Key: "content/a/content.html",
						}),
						emailRow({
							receivedAtMessageId: "2026-06-23T08:00:00.000Z#<b@x>",
							status: "rejected",
							rawEmailS3Key: "inbound/b",
							// A rejected row renders no body, so DynamoDB returns null here,
							// which the row schema normalizes to undefined.
							bodyS3Key: null,
						}),
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const refs = await store.listDeletionReferencesByUserId(USER);

			expect(refs.receivedAtMessageIds).toEqual([
				"2026-06-23T09:00:00.000Z#<a@x>",
				"2026-06-23T08:00:00.000Z#<b@x>",
			]);
			expect(refs.rawEmailS3Keys).toEqual(["inbound/a", "inbound/b"]);
			expect(refs.bodyS3Keys).toEqual(["content/a/content.html"]);
			// One opaque image prefix per row — bodied or not — recomputed from the
			// row keys, so image objects never outlive the account.
			expect(refs.emailImageS3KeyPrefixes).toEqual([
				emailImageS3KeyPrefix({
					userId: USER,
					receivedAtMessageId: "2026-06-23T09:00:00.000Z#<a@x>",
				}),
				emailImageS3KeyPrefix({
					userId: USER,
					receivedAtMessageId: "2026-06-23T08:00:00.000Z#<b@x>",
				}),
			]);
			const query = commands.find((c) => c.name === "QueryCommand");
			expect(query?.input.KeyConditionExpression).toBe("userId = :uid");
			expect(query?.input.ExpressionAttributeValues).toEqual({ ":uid": USER });
			// Read-only: the rows survive so a redrive can re-derive the keys.
			expect(commands.some((c) => c.name === "DeleteCommand")).toBe(false);
		});

		it("paginates the query, feeding each page's key back as ExclusiveStartKey", async () => {
			const { client, commands } = createPaginatedClient([
				{
					rows: [
						emailRow({ receivedAtMessageId: "r1", rawEmailS3Key: "inbound/1", bodyS3Key: null }),
					],
					lastEvaluatedKey: { userId: "user-1", receivedAtMessageId: "r1" },
				},
				{
					rows: [
						emailRow({ receivedAtMessageId: "r2", rawEmailS3Key: "inbound/2", bodyS3Key: null }),
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			const refs = await store.listDeletionReferencesByUserId(USER);

			const queries = commands.filter((c) => c.name === "QueryCommand");
			expect(queries).toHaveLength(2);
			expect(queries[0]?.input.ExclusiveStartKey).toBeUndefined();
			expect(queries[1]?.input.ExclusiveStartKey).toEqual({
				userId: "user-1",
				receivedAtMessageId: "r1",
			});
			expect(refs.rawEmailS3Keys).toEqual(["inbound/1", "inbound/2"]);
			expect(refs.bodyS3Keys).toEqual([]);
			expect(commands.some((c) => c.name === "DeleteCommand")).toBe(false);
		});

		it("returns empty lists and issues no delete when the user has no emails", async () => {
			const { client, commands } = createPaginatedClient([{ rows: [] }]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			expect(await store.listDeletionReferencesByUserId(USER)).toEqual({
				receivedAtMessageIds: [],
				rawEmailS3Keys: [],
				bodyS3Keys: [],
				emailImageS3KeyPrefixes: [],
			});
			expect(commands.some((c) => c.name === "DeleteCommand")).toBe(false);
		});
	});

	describe("deleteAllEmailsByUserId", () => {
		it("deletes every row the user owns", async () => {
			const { client, commands } = createPaginatedClient([
				{
					rows: [
						emailRow({ receivedAtMessageId: "2026-06-23T09:00:00.000Z#<a@x>" }),
						emailRow({ receivedAtMessageId: "2026-06-23T08:00:00.000Z#<b@x>" }),
					],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			await store.deleteAllEmailsByUserId(USER);

			const query = commands.find((c) => c.name === "QueryCommand");
			expect(query?.input.KeyConditionExpression).toBe("userId = :uid");
			expect(query?.input.ExpressionAttributeValues).toEqual({ ":uid": USER });
			const deletes = commands.filter((c) => c.name === "DeleteCommand");
			expect(deletes.map((c) => c.input.Key)).toEqual([
				{ userId: USER, receivedAtMessageId: "2026-06-23T09:00:00.000Z#<a@x>" },
				{ userId: USER, receivedAtMessageId: "2026-06-23T08:00:00.000Z#<b@x>" },
			]);
		});

		it("paginates, deleting each page's rows and feeding its key back as ExclusiveStartKey", async () => {
			const { client, commands } = createPaginatedClient([
				{
					rows: [emailRow({ receivedAtMessageId: "r1" })],
					lastEvaluatedKey: { userId: "user-1", receivedAtMessageId: "r1" },
				},
				{
					rows: [emailRow({ receivedAtMessageId: "r2" })],
				},
			]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			await store.deleteAllEmailsByUserId(USER);

			const queries = commands.filter((c) => c.name === "QueryCommand");
			expect(queries).toHaveLength(2);
			expect(queries[1]?.input.ExclusiveStartKey).toEqual({
				userId: "user-1",
				receivedAtMessageId: "r1",
			});
			const deletes = commands.filter((c) => c.name === "DeleteCommand");
			expect(deletes.map((c) => c.input.Key)).toEqual([
				{ userId: USER, receivedAtMessageId: "r1" },
				{ userId: USER, receivedAtMessageId: "r2" },
			]);
		});

		it("issues no delete when the user has no emails", async () => {
			const { client, commands } = createPaginatedClient([{ rows: [] }]);
			const store = initDynamoDbInboxEmail({ client, tableName: TABLE });

			await store.deleteAllEmailsByUserId(USER);

			expect(commands.some((c) => c.name === "DeleteCommand")).toBe(false);
		});
	});
});
