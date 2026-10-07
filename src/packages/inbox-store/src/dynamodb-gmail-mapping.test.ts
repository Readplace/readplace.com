import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailMapping } from "./dynamodb-gmail-mapping";

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
		KeyConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

const TABLE = "test-gmail-mappings";
const USER = UserIdSchema.parse("user-1");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const WORK = GmailAccountEmailSchema.parse("reader@work.example");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const TECH = InboxAddressSchema.parse("tech-a7b2c9@read.place");
const TRAVEL = InboxAddressSchema.parse("travel-a7b2c9@read.place");
const NOW = new Date("2026-08-27T00:00:00.000Z");
const TLDR_KEY = { userId: USER, mappingKey: "reader@gmail.com#dan@tldr.tech" };

function row(overrides: Record<string, unknown> = {}) {
	return { ...TLDR_KEY, accountEmail: ACCOUNT, senderEmail: TLDR, ...overrides };
}

function harness(reply: (input: unknown) => unknown = () => ({})) {
	const commands: CapturedCommand[] = [];
	const store = initDynamoDbGmailMapping({
		client: createFakeClient((input) => {
			commands.push(input as CapturedCommand);
			return reply(input);
		}) as DynamoDBDocumentClient,
		tableName: TABLE,
		now: () => NOW,
	});
	return { store, commands };
}

describe("initDynamoDbGmailMapping", () => {
	it("keeps the original filter timestamp when a sender is re-added under its Gmail account", async () => {
		const { store, commands } = harness();

		await store.addSenderToFilter({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR });

		assert.deepEqual(commands[0].input.Key, TLDR_KEY);
		assert.equal(
			commands[0].input.UpdateExpression,
			"SET accountEmail = :account, senderEmail = :sender, addedToFilterAt = if_not_exists(addedToFilterAt, :now)",
		);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":account": ACCOUNT,
			":sender": TLDR,
			":now": NOW.toISOString(),
		});
	});

	it("maps a sender onto the address its mail should land in", async () => {
		const { store, commands } = harness();

		await store.mapSenderToAddress({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR, mappedAddresses: [TECH], deliveryMode: "issue" });

		assert.deepEqual(commands[0].input.Key, TLDR_KEY);
		assert.equal(
			commands[0].input.UpdateExpression,
			"SET accountEmail = :account, senderEmail = :sender, mappedAddress = :addr, mappedAt = :now, deliveryMode = :mode REMOVE additionalMappedAddresses",
		);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":account": ACCOUNT,
			":sender": TLDR,
			":addr": TECH,
			":now": NOW.toISOString(),
			":mode": "issue",
		});
	});

	it("persists additional destinations beside the primary address", async () => {
		const { store, commands } = harness();

		await store.mapSenderToAddress({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR, mappedAddresses: [TECH, TRAVEL], deliveryMode: "both" });

		assert.equal(
			commands[0].input.UpdateExpression,
			"SET accountEmail = :account, senderEmail = :sender, mappedAddress = :addr, mappedAt = :now, deliveryMode = :mode, additionalMappedAddresses = :additional",
		);
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
			":account": ACCOUNT,
			":sender": TLDR,
			":addr": TECH,
			":now": NOW.toISOString(),
			":mode": "both",
			":additional": [TRAVEL],
		});
	});

	it("reads one mapping as a point read under its Gmail account", async () => {
		const { store, commands } = harness(() => ({
			Item: row({ addedToFilterAt: NOW.toISOString(), mappedAddress: TECH, additionalMappedAddresses: [TRAVEL], mappedAt: NOW.toISOString(), deliveryMode: "links" }),
		}));

		const mapping = await store.findMapping({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR });

		assert.deepEqual(mapping, {
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			addedToFilterAt: NOW.toISOString(),
			mappedAddresses: [TECH, TRAVEL],
			mappedAt: NOW.toISOString(),
			deliveryMode: "links",
		});
		assert.deepEqual(commands[0].input.Key, TLDR_KEY);
	});

	it("returns undefined for a sender the Gmail account has no mapping for", async () => {
		const { store } = harness();

		assert.equal(await store.findMapping({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR }), undefined);
	});

	it("lists only the requested Gmail account's mappings across every page", async () => {
		let call = 0;
		const { store, commands } = harness(() => {
			call += 1;
			if (call === 1) {
				return { Items: [row({ mappedAddress: TECH })], LastEvaluatedKey: TLDR_KEY };
			}
			return { Items: [row({ mappingKey: `${ACCOUNT}#${BREW}`, senderEmail: BREW })] };
		});

		const mappings = await store.listMappings({ userId: USER, accountEmail: ACCOUNT });

		assert.deepEqual(
			mappings.map((mapping) => [mapping.senderEmail, mapping.mappedAddresses]),
			[[TLDR, [TECH]], [BREW, undefined]],
		);
		assert.equal(commands[0].input.KeyConditionExpression, "userId = :uid AND begins_with(mappingKey, :account)");
		assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ":uid": USER, ":account": "reader@gmail.com#" });
	});

	it("lists the mappings of every Gmail account a reader connected", async () => {
		const { store, commands } = harness(() => ({
			Items: [row(), row({ mappingKey: `${WORK}#${BREW}`, accountEmail: WORK, senderEmail: BREW })],
		}));

		const mappings = await store.listMappingsByUserId(USER);

		assert.deepEqual(
			mappings.map((mapping) => [mapping.accountEmail, mapping.senderEmail]),
			[[ACCOUNT, TLDR], [WORK, BREW]],
		);
		assert.equal(commands[0].input.KeyConditionExpression, "userId = :uid");
	});

	it("removes one mapping by its key", async () => {
		const { store, commands } = harness();

		await store.removeMapping({ userId: USER, accountEmail: ACCOUNT, senderEmail: TLDR });

		assert.deepEqual(commands[0].input.Key, TLDR_KEY);
	});

	it("deletes the mappings of every Gmail account a reader connected", async () => {
		const workKey = `${WORK}#${BREW}`;
		const { store, commands } = harness((input) =>
			(input as CapturedCommand).input.Key === undefined
				? { Items: [row(), row({ mappingKey: workKey, accountEmail: WORK, senderEmail: BREW })] }
				: {},
		);

		await store.deleteAllByUserId(USER);

		assert.deepEqual(
			commands.filter((command) => command.input.Key !== undefined).map((command) => command.input.Key),
			[TLDR_KEY, { userId: USER, mappingKey: workKey }],
		);
	});
});
