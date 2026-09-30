import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { GmailAccountEmailSchema, GmailHistoryImportJobIdSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { EmailIdentityKeySchema, type IngestionAttempt } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbEmailIdentity } from "./dynamodb-email-identity";

type SendFn = DynamoDBDocumentClient["send"];

interface SentCommand {
	name: string;
	input: {
		Item?: Record<string, unknown>;
		Key?: { identityKey: string };
		ConsistentRead?: boolean;
		IndexName?: string;
		ConditionExpression?: string;
		UpdateExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
}

const TABLE = "test-email-identities";
const USER = UserIdSchema.parse("user-1");
const KEY = EmailIdentityKeySchema.parse("MSG#user-1#news@example.com#m-1@example.com");
const NOW = new Date("2026-09-30T00:00:00.000Z");
const LATER = new Date("2026-09-30T01:00:00.000Z");
const FORWARDED: IngestionAttempt = { origin: "receive", sesMessageId: "ses-1" };
const IMPORTED: IngestionAttempt = {
	origin: "gmail-import",
	jobId: GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef"),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2"),
};

function identityTable(options: { interrupt?: (command: SentCommand) => void; queryPages?: Record<string, unknown>[][] } = {}) {
	const items = new Map<string, Record<string, unknown>>();
	const commands: SentCommand[] = [];
	let queries = 0;
	const send = async (command: { constructor: { name: string }; input: SentCommand["input"] }) => {
		const sent = { name: command.constructor.name, input: command.input };
		commands.push(sent);
		options.interrupt?.(sent);
		const key = sent.input.Key?.identityKey;
		switch (sent.name) {
			case "GetCommand":
				return { Item: key === undefined ? undefined : items.get(key) };
			case "PutCommand": {
				const item = sent.input.Item;
				assert(item);
				if (items.has(String(item.identityKey))) {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				}
				items.set(String(item.identityKey), item);
				return {};
			}
			case "UpdateCommand": {
				assert(key);
				const row = items.get(key);
				const values = sent.input.ExpressionAttributeValues;
				if (row?.attemptKey !== values?.[":previousAttemptKey"]) {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "moved" });
				}
				items.set(key, { ...row, attempt: values?.[":attempt"], attemptKey: values?.[":attemptKey"], claimedAt: values?.[":now"] });
				return {};
			}
			case "DeleteCommand":
				assert(key);
				items.delete(key);
				return {};
			case "QueryCommand": {
				const pages = options.queryPages ?? [];
				const page = pages[queries] ?? [];
				queries += 1;
				return { Items: page, Count: page.length, LastEvaluatedKey: queries < pages.length ? { identityKey: "next" } : undefined };
			}
		}
		throw new Error(`unexpected ${sent.name}`);
	};
	const client: Partial<DynamoDBDocumentClient> = { send: send as unknown as SendFn };
	const store = initDynamoDbEmailIdentity({ client: client as DynamoDBDocumentClient, tableName: TABLE });
	return { items, commands, store };
}

describe("initDynamoDbEmailIdentity", () => {
	it("claims an unclaimed identity with a conditional put and finds it again with a consistent read", async () => {
		const { commands, store } = identityTable();

		const result = await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, now: NOW });

		const claim = { key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, claimedAt: NOW.toISOString() };
		expect(result).toEqual({ status: "claimed", claim });
		expect(commands[0].input).toEqual(
			expect.objectContaining({
				TableName: TABLE,
				Item: { identityKey: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, attemptKey: "receive#ses-1", claimedAt: NOW.toISOString() },
				ConditionExpression: "attribute_not_exists(identityKey)",
			}),
		);
		expect(await store.find(KEY)).toEqual(claim);
		expect(commands[1].input).toEqual(expect.objectContaining({ Key: { identityKey: KEY }, ConsistentRead: true }));
		expect(await store.find(EmailIdentityKeySchema.parse("MSG#user-1#other@example.com#m-2"))).toBeUndefined();
	});

	it("reports the stored claim as the same attempt when the same delivery claims again", async () => {
		const { store } = identityTable();
		await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: IMPORTED, now: NOW });

		const again = await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r2", attempt: { ...IMPORTED }, now: LATER });

		expect(again).toEqual({
			status: "same-attempt",
			claim: { key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: IMPORTED, claimedAt: NOW.toISOString() },
		});
	});

	it("reports the stored claim as claimed elsewhere when a different delivery holds the identity", async () => {
		const { store } = identityTable();
		await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, now: NOW });

		const other = await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r2", attempt: IMPORTED, now: LATER });

		expect(other.status).toBe("claimed-elsewhere");
		expect(other.claim.receivedAtMessageId).toBe("r1");
		expect(other.claim.attempt).toEqual(FORWARDED);
	});

	it("rethrows a claim failure that is not a lost race", async () => {
		const offline = new Error("offline");
		const { store } = identityTable({ interrupt: () => { throw offline; } });

		await expect(store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, now: NOW })).rejects.toBe(offline);
	});

	it("takes over a claim only while the stored attempt is still the one the caller saw", async () => {
		const { commands, store } = identityTable();
		const { claim: previous } = await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, now: NOW });

		expect(await store.takeOver({ previous, attempt: IMPORTED, now: LATER })).toBe(true);
		expect(commands[1].input.ConditionExpression).toBe("attemptKey = :previousAttemptKey");
		expect(await store.find(KEY)).toEqual({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: IMPORTED, claimedAt: LATER.toISOString() });

		expect(await store.takeOver({ previous, attempt: { origin: "receive", sesMessageId: "ses-9" }, now: LATER })).toBe(false);
		expect((await store.find(KEY))?.attempt).toEqual(IMPORTED);
	});

	it("rethrows a takeover failure that is not a lost race", async () => {
		const offline = new Error("offline");
		const { store } = identityTable({
			interrupt: (command) => {
				if (command.name === "UpdateCommand") throw offline;
			},
		});
		const { claim: previous } = await store.claim({ key: KEY, userId: USER, receivedAtMessageId: "r1", attempt: FORWARDED, now: NOW });

		await expect(store.takeOver({ previous, attempt: IMPORTED, now: LATER })).rejects.toBe(offline);
	});

	it("deletes every identity the user holds, page by page, through the userId index", async () => {
		const { commands, store } = identityTable({
			queryPages: [
				[{ identityKey: "MSG#user-1#a@example.com#1", userId: USER }],
				[{ identityKey: "MSG#user-1#b@example.com#2", userId: USER }],
			],
		});

		await store.deleteAllByUserId(USER);

		const queries = commands.filter((c) => c.name === "QueryCommand");
		expect(queries.map((c) => c.input.IndexName)).toEqual(["userId-index", "userId-index"]);
		expect(queries[0].input.ExpressionAttributeValues).toEqual({ ":uid": USER });
		expect(queries[1].input.ExclusiveStartKey).toEqual({ identityKey: "next" });
		expect(commands.filter((c) => c.name === "DeleteCommand").map((c) => c.input.Key)).toEqual([
			{ identityKey: "MSG#user-1#a@example.com#1" },
			{ identityKey: "MSG#user-1#b@example.com#2" },
		]);
	});
});
