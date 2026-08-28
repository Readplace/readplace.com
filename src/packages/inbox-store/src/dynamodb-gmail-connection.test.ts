import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailConnection } from "./dynamodb-gmail-connection";

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
		IndexName?: string;
		Select?: string;
		UpdateExpression?: string;
		KeyConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

const TABLE = "test-gmail-connections";
const USER = UserIdSchema.parse("user-1");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const NOW = new Date("2026-08-27T00:00:00.000Z");

function harness(reply: (input: unknown) => unknown = () => ({})) {
	const commands: CapturedCommand[] = [];
	const store = initDynamoDbGmailConnection({
		client: createFakeClient((input) => {
			commands.push(input as CapturedCommand);
			return reply(input);
		}) as DynamoDBDocumentClient,
		tableName: TABLE,
		now: () => NOW,
	});
	return { store, commands };
}

describe("initDynamoDbGmailConnection", () => {
	it("creates the row already marked connected and returns the fresh connection", async () => {
		const { store, commands } = harness();

		const connection = await store.createConnection({
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
		});

		assert.deepEqual(commands[0].input.Item, {
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
			connectedAt: NOW.toISOString(),
			connected: "yes",
		});
		assert.deepEqual(connection, {
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
			connectedAt: NOW.toISOString(),
			forwardingConfirmedAt: undefined,
			filterId: undefined,
			filterQuery: undefined,
			filterSenderCount: undefined,
			filterUpdatedAt: undefined,
			lastFilterError: undefined,
			revokedAt: undefined,
			revokedReason: undefined,
		});
	});

	it("reads a live connection back without leaking the index marker", async () => {
		const { store, commands } = harness(() => ({
			Item: {
				userId: USER,
				gatewayAddress: GATEWAY,
				googleAccountEmail: "reader@gmail.com",
				connectedAt: NOW.toISOString(),
				forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
				filterId: "filter-1",
				filterQuery: "from:(dan@tldr.tech)",
				filterSenderCount: 1,
				filterUpdatedAt: "2026-08-27T00:06:00.000Z",
				connected: "yes",
			},
		}));

		const connection = await store.findConnectionByUserId(USER);

		assert.deepEqual(commands[0].input.Key, { userId: USER });
		assert.deepEqual(connection, {
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
			connectedAt: NOW.toISOString(),
			forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
			filterId: "filter-1",
			filterQuery: "from:(dan@tldr.tech)",
			filterSenderCount: 1,
			filterUpdatedAt: "2026-08-27T00:06:00.000Z",
			lastFilterError: undefined,
			revokedAt: undefined,
			revokedReason: undefined,
		});
	});

	it("returns undefined when the user has never connected Gmail", async () => {
		const { store } = harness();

		assert.equal(await store.findConnectionByUserId(USER), undefined);
	});

	it("keeps the first confirmation timestamp when Google confirms twice", async () => {
		const { store, commands } = harness();

		await store.markForwardingConfirmed({ userId: USER });

		assert.match(
			String(commands[0].input.UpdateExpression),
			/if_not_exists\(forwardingConfirmedAt, :now\)/,
		);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":now": NOW.toISOString(),
		});
	});

	it("drops the connection back to step 2 when Google stops recognising the address", async () => {
		const { store, commands } = harness();

		await store.clearForwardingConfirmed({ userId: USER });

		assert.match(String(commands[0].input.UpdateExpression), /REMOVE forwardingConfirmedAt/);
	});

	it("clears the last error when a filter write succeeds", async () => {
		const { store, commands } = harness();

		await store.recordFilter({
			userId: USER,
			filterId: "filter-1",
			filterQuery: "from:(dan@tldr.tech)",
			filterSenderCount: 1,
		});

		const expression = String(commands[0].input.UpdateExpression);
		assert.match(expression, /SET filterId = :id/);
		assert.match(expression, /REMOVE lastFilterError/);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":id": "filter-1",
			":q": "from:(dan@tldr.tech)",
			":n": 1,
			":now": NOW.toISOString(),
		});
	});

	it("records a filter failure so the page can surface it", async () => {
		const { store, commands } = harness();
		const error = {
			code: "query-too-long",
			message: "1200 characters over the limit",
			at: NOW.toISOString(),
		} as const;

		await store.recordFilterError({ userId: USER, error });

		assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ":err": error });
	});

	it("removes the index marker when the grant is revoked so the count drops", async () => {
		const { store, commands } = harness();

		await store.markRevoked({ userId: USER, reason: "invalid-grant" });

		assert.match(String(commands[0].input.UpdateExpression), /REMOVE connected/);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":now": NOW.toISOString(),
			":reason": "invalid-grant",
		});
	});

	it("forgets the filter entirely when the last sender goes", async () => {
		const { store, commands } = harness();

		await store.clearFilter({ userId: USER });

		assert.match(
			String(commands[0].input.UpdateExpression),
			/REMOVE filterId, filterQuery, filterSenderCount, filterUpdatedAt, lastFilterError/,
		);
	});

	it("restores the index marker when the reader reconnects", async () => {
		const { store, commands } = harness();

		await store.clearRevoked({ userId: USER });

		const expression = String(commands[0].input.UpdateExpression);
		assert.match(expression, /SET connected = :c/);
		assert.match(expression, /REMOVE revokedAt, revokedReason/);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ":c": "yes" });
	});

	it("deletes the connection row by user id", async () => {
		const { store, commands } = harness();

		await store.deleteConnection(USER);

		assert.deepEqual(commands[0].input.Key, { userId: USER });
	});

	it("counts live connections off the sparse index without reading any row", async () => {
		const { store, commands } = harness(() => ({ Count: 42 }));

		assert.equal(await store.countConnected(), 42);
		assert.equal(commands[0].input.IndexName, "connected-index");
		assert.equal(commands[0].input.Select, "COUNT");
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ":c": "yes" });
	});
});
