import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailCredentials } from "./dynamodb-gmail-credentials";

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
	};
}

const TABLE = "test-gmail-credentials";
const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-08-24T00:00:00.000Z");

function harness(reply: (input: unknown) => unknown) {
	const commands: CapturedCommand[] = [];
	const store = initDynamoDbGmailCredentials({
		client: createFakeClient((input) => {
			commands.push(input as CapturedCommand);
			return reply(input);
		}) as DynamoDBDocumentClient,
		tableName: TABLE,
		now: () => NOW,
	});
	return { store, commands };
}

describe("initDynamoDbGmailCredentials", () => {
	it("writes the refresh token with the granted scope and a connected timestamp", async () => {
		const { store, commands } = harness(() => ({}));

		await store.saveCredentials({
			userId: USER,
			refreshToken: "refresh-token-value",
			grantedScope: "https://www.googleapis.com/auth/gmail.settings.basic",
		});

		assert.equal(commands.length, 1);
		assert.deepEqual(commands[0].input.Item, {
			userId: USER,
			refreshToken: "refresh-token-value",
			grantedScope: "https://www.googleapis.com/auth/gmail.settings.basic",
			connectedAt: NOW.toISOString(),
		});
	});

	it("reads the refresh token by user id", async () => {
		const { store, commands } = harness(() => ({
			Item: {
				userId: USER,
				refreshToken: "refresh-token-value",
				grantedScope: "https://www.googleapis.com/auth/gmail.settings.basic",
				connectedAt: NOW.toISOString(),
			},
		}));

		const token = await store.findRefreshTokenByUserId(USER);

		assert.equal(token, "refresh-token-value");
		assert.deepEqual(commands[0].input.Key, { userId: USER });
	});

	it("returns undefined when the user has never connected Gmail", async () => {
		const { store } = harness(() => ({}));

		assert.equal(await store.findRefreshTokenByUserId(USER), undefined);
	});

	it("deletes the credentials row by user id", async () => {
		const { store, commands } = harness(() => ({}));

		await store.deleteCredentials(USER);

		assert.deepEqual(commands[0].input.Key, { userId: USER });
	});
});
