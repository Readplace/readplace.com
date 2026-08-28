import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailSender } from "./dynamodb-gmail-sender";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (input: unknown) => unknown): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

interface CapturedCommand {
	input: {
		Key?: Record<string, unknown>;
		UpdateExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
}

const TABLE = "test-gmail-senders";
const USER = UserIdSchema.parse("user-1");
const SENDER = ForwardableSenderSchema.parse("dan@tldr.tech");
const ALIAS = InboxAddressSchema.parse("tldr-a7b2c9@read.place");
const NOW = new Date("2026-08-27T00:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
	return { userId: USER, senderEmail: SENDER, ...overrides };
}

function harness(reply: (input: unknown) => unknown = () => ({})) {
	const commands: CapturedCommand[] = [];
	const store = initDynamoDbGmailSender({
		client: createFakeClient((input) => {
			commands.push(input as CapturedCommand);
			return reply(input);
		}) as DynamoDBDocumentClient,
		tableName: TABLE,
		now: () => NOW,
	});
	return { store, commands };
}

describe("initDynamoDbGmailSender", () => {
	it("keeps the original filter timestamp when a sender is re-added", async () => {
		const { store, commands } = harness();

		await store.addSenderToFilter({ userId: USER, senderEmail: SENDER });

		assert.deepEqual(commands[0].input.Key, { userId: USER, senderEmail: SENDER });
		assert.match(
			String(commands[0].input.UpdateExpression),
			/if_not_exists\(addedToFilterAt, :now\)/,
		);
	});

	it("counts every sighting while keeping the first-seen timestamp", async () => {
		const { store, commands } = harness();

		await store.recordSenderSeen({
			userId: USER,
			senderEmail: SENDER,
			subject: "TLDR 2026-08-27",
		});

		const expression = String(commands[0].input.UpdateExpression);
		assert.match(expression, /firstSeenAt = if_not_exists\(firstSeenAt, :now\)/);
		assert.match(expression, /ADD seenCount :one/);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":now": NOW.toISOString(),
			":subject": "TLDR 2026-08-27",
			":one": 1,
		});
	});

	it("maps a sender onto the alias its mail should land in", async () => {
		const { store, commands } = harness();

		await store.mapSenderToAddress({
			userId: USER,
			senderEmail: SENDER,
			mappedAddress: ALIAS,
		});

		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":addr": ALIAS,
			":now": NOW.toISOString(),
		});
	});

	it("reads one sender as a point read", async () => {
		const { store, commands } = harness(() => ({
			Item: row({ addedToFilterAt: NOW.toISOString(), seenCount: 3 }),
		}));

		const sender = await store.findSender({ userId: USER, senderEmail: SENDER });

		assert.equal(sender?.seenCount, 3);
		assert.deepEqual(commands[0].input.Key, { userId: USER, senderEmail: SENDER });
	});

	it("returns undefined for a sender the reader has never met", async () => {
		const { store } = harness();

		assert.equal(await store.findSender({ userId: USER, senderEmail: SENDER }), undefined);
	});

	it("walks every page when listing a reader's senders", async () => {
		let call = 0;
		const { store } = harness(() => {
			call += 1;
			if (call === 1) {
				return { Items: [row()], LastEvaluatedKey: { userId: USER, senderEmail: SENDER } };
			}
			return { Items: [row({ senderEmail: ForwardableSenderSchema.parse("crew@morningbrew.com") })] };
		});

		const senders = await store.listSendersByUserId(USER);

		assert.deepEqual(
			senders.map((sender) => sender.senderEmail),
			[SENDER, "crew@morningbrew.com"],
		);
	});

	it("removes one sender by its key", async () => {
		const { store, commands } = harness();

		await store.removeSender({ userId: USER, senderEmail: SENDER });

		assert.deepEqual(commands[0].input.Key, { userId: USER, senderEmail: SENDER });
	});

	it("deletes every sender a reader owns on account deletion", async () => {
		const { store, commands } = harness((input) =>
			(input as CapturedCommand).input.Key === undefined ? { Items: [row()] } : {},
		);

		await store.deleteAllSendersByUserId(USER);

		const deletes = commands.filter((command) => command.input.Key !== undefined);
		assert.deepEqual(deletes.map((command) => command.input.Key), [
			{ userId: USER, senderEmail: SENDER },
		]);
	});
});
