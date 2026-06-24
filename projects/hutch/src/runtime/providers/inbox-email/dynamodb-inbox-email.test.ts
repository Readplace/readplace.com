import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import {
	InboxAddressSchema,
	type InboxEmailEntry,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbInboxEmail } from "./dynamodb-inbox-email";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (input: unknown) => unknown): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

interface CapturedCommand {
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		KeyConditionExpression?: string;
		ConditionExpression?: string;
		ScanIndexForward?: boolean;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
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
		it("queries the base table newest-first, normalizing a missing body pointer", async () => {
			let captured: CapturedCommand | undefined;
			const store = initDynamoDbInboxEmail({
				client: createFakeClient((cmd) => {
					captured = cmd as CapturedCommand;
					return {
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
						Count: 2,
					};
				}) as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const result = await store.listEmailsByUserId(USER);

			expect(captured?.input.KeyConditionExpression).toBe("userId = :uid");
			expect(captured?.input.ExpressionAttributeValues?.[":uid"]).toBe(USER);
			expect(captured?.input.ScanIndexForward).toBe(false);
			expect(result).toHaveLength(2);
			expect(result[0].subject).toBe("Newer");
			expect(result[0].bodyS3Key).toBe("content/b/content.html");
			expect(result[1].bodyS3Key).toBeUndefined();
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
});
