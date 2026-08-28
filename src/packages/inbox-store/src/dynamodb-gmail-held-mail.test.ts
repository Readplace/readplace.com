import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailHeldMail } from "./dynamodb-gmail-held-mail";

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
		Limit?: number;
		ScanIndexForward?: boolean;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

const TABLE = "test-gmail-held-mail";
const USER = UserIdSchema.parse("user-1");
const SENDER = ForwardableSenderSchema.parse("dan@tldr.tech");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const RECEIVED_AT_MESSAGE_ID = "2026-08-27T00:00:00.000Z#<tldr@mail.tldr.tech>";

const ENTRY = {
	userId: USER,
	receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
	senderEmail: SENDER,
	subject: "TLDR 2026-08-27",
	receivedAt: "2026-08-27T00:00:00.000Z",
	rawEmailS3Key: "raw/user-1/tldr.eml",
	recipientAddress: GATEWAY,
};

function harness(reply: (input: unknown) => unknown = () => ({})) {
	const commands: CapturedCommand[] = [];
	const store = initDynamoDbGmailHeldMail({
		client: createFakeClient((input) => {
			commands.push(input as CapturedCommand);
			return reply(input);
		}) as DynamoDBDocumentClient,
		tableName: TABLE,
	});
	return { store, commands };
}

describe("initDynamoDbGmailHeldMail", () => {
	it("stores held mail with the sender-scoped sort key the preview reads", async () => {
		const { store, commands } = harness();

		assert.equal(await store.holdMail(ENTRY), "stored");
		assert.deepEqual(commands[0].input.Item, {
			...ENTRY,
			senderReceivedAt: `${SENDER}#${RECEIVED_AT_MESSAGE_ID}`,
		});
	});

	it("reports a redelivered message as a duplicate rather than overwriting it", async () => {
		const { store } = harness(() => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
		});

		assert.equal(await store.holdMail(ENTRY), "duplicate");
	});

	it("propagates a write failure that is not a duplicate", async () => {
		const { store } = harness(() => {
			throw new Error("throughput exceeded");
		});

		await assert.rejects(store.holdMail(ENTRY), /throughput exceeded/);
	});

	it("reads the newest held mail for one sender off the index", async () => {
		const { store, commands } = harness(() => ({
			Items: [{ ...ENTRY, senderReceivedAt: `${SENDER}#${RECEIVED_AT_MESSAGE_ID}` }],
		}));

		const held = await store.listHeldMailBySender({ userId: USER, senderEmail: SENDER, limit: 5 });

		assert.deepEqual(held, [ENTRY]);
		assert.equal(commands[0].input.IndexName, "senderReceivedAt-index");
		assert.equal(commands[0].input.ScanIndexForward, false);
		assert.equal(commands[0].input.Limit, 5);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":uid": USER,
			":prefix": `${SENDER}#`,
		});
	});

	it("refuses a limit that is not a whole number of messages", async () => {
		const { store } = harness();

		await assert.rejects(
			store.listHeldMailBySender({ userId: USER, senderEmail: SENDER, limit: 1.5 }),
			/limit must be an integer/,
		);
		await assert.rejects(
			store.listHeldMailBySender({ userId: USER, senderEmail: SENDER, limit: 0 }),
			/limit must be >= 1/,
		);
	});

	it("deletes every held message a reader owns on account deletion", async () => {
		const { store, commands } = harness((input) =>
			(input as CapturedCommand).input.Key === undefined
				? { Items: [{ ...ENTRY, senderReceivedAt: `${SENDER}#${RECEIVED_AT_MESSAGE_ID}` }] }
				: {},
		);

		await store.deleteAllHeldMailByUserId(USER);

		const deletes = commands.filter((command) => command.input.Key !== undefined);
		assert.deepEqual(deletes.map((command) => command.input.Key), [
			{ userId: USER, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID },
		]);
	});
});
