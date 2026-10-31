import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { ISSUE_OUTPUT_KEY, linkOutputKey, formatEmailLinkOrdinal } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbEmailImportCompletion } from "./dynamodb-email-import-completion";

type SendFn = DynamoDBDocumentClient["send"];
interface Sent {
	name: string;
	input: Record<string, unknown> & { ExpressionAttributeValues?: Record<string, unknown> };
}

const USER = UserIdSchema.parse("user-1");
const RAM = "2026-10-27T00:00:00.000Z#<id@example.com>";
const KEY = { userId: USER, receivedAtMessageId: RAM };
const ORIGIN = { kind: "history" as const, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("m1"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };
const SELECTION = { outputs: [ISSUE_OUTPUT_KEY], truncated: false, selectedAt: "2026-10-27T00:00:01.000Z" };

function conditionFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ message: "condition", $metadata: {} });
}

function fakeClient(respond: (command: Sent) => unknown): { client: DynamoDBDocumentClient; sent: Sent[] } {
	const sent: Sent[] = [];
	const send = (async (command: { constructor: { name: string }; input: Sent["input"] }) => {
		const recorded = { name: command.constructor.name, input: command.input };
		sent.push(recorded);
		return respond(recorded);
	}) as SendFn;
	return { client: { send } as unknown as DynamoDBDocumentClient, sent };
}

function store(respond: (command: Sent) => unknown = () => ({})) {
	const fake = fakeClient(respond);
	return { completion: initDynamoDbEmailImportCompletion({ client: fake.client, tableName: "emails" }), sent: fake.sent };
}

describe("initDynamoDbEmailImportCompletion", () => {
	it("adds Gmail origins to the email row's set", async () => {
		const { completion, sent } = store();
		await completion.addGmailOrigins({ ...KEY, origins: [ORIGIN] });
		assert.equal(sent[0].input.UpdateExpression, "ADD gmailOrigins :origins");
		assert.equal(sent[0].input.ConditionExpression, "attribute_exists(receivedAtMessageId)");
		assert.deepEqual(sent[0].input.ExpressionAttributeValues?.[":origins"], new Set([JSON.stringify(ORIGIN)]));
	});

	it("writes nothing when there are no origins to add", async () => {
		const { completion, sent } = store();
		await completion.addGmailOrigins({ ...KEY, origins: [] });
		assert.equal(sent.length, 0);
	});

	it("stores the first selection and returns it", async () => {
		const { completion, sent } = store();
		assert.deepEqual(await completion.selectOutputs({ ...KEY, selection: SELECTION }), SELECTION);
		assert.match(String(sent[0].input.ConditionExpression), /attribute_not_exists\(outputSelection\)/);
	});

	it("returns the already-frozen selection instead of a later one", async () => {
		const frozen = { ...SELECTION, outputs: [linkOutputKey(formatEmailLinkOrdinal(0))] };
		const { completion, sent } = store((command) => {
			if (command.name === "UpdateCommand") throw conditionFailed();
			return { Item: { ...KEY, outputSelection: frozen } };
		});
		assert.deepEqual(await completion.selectOutputs({ ...KEY, selection: SELECTION }), frozen);
		assert.equal(sent[1].input.ConsistentRead, true);
	});

	it("rethrows a selection write failure that is not a lost condition", async () => {
		const { completion } = store(() => {
			throw new Error("throttled");
		});
		await assert.rejects(completion.selectOutputs({ ...KEY, selection: SELECTION }), /throttled/);
	});

	it("acknowledges an output by adding it to the saved set", async () => {
		const { completion, sent } = store();
		await completion.acknowledgeOutput({ ...KEY, output: ISSUE_OUTPUT_KEY });
		assert.equal(sent[0].input.UpdateExpression, "ADD savedOutputs :output");
		assert.deepEqual(sent[0].input.ExpressionAttributeValues?.[":output"], new Set(["issue"]));
	});

	it("ignores an acknowledgement for an email row that no longer exists", async () => {
		const { completion } = store(() => {
			throw conditionFailed();
		});
		await completion.acknowledgeOutput({ ...KEY, output: ISSUE_OUTPUT_KEY });
	});

	it("rethrows an acknowledgement failure that is not a missing row", async () => {
		const { completion } = store(() => {
			throw new Error("throttled");
		});
		await assert.rejects(completion.acknowledgeOutput({ ...KEY, output: ISSUE_OUTPUT_KEY }), /throttled/);
	});

	it("reads the completion state with a consistent read", async () => {
		const { completion, sent } = store(() => ({
			Item: { ...KEY, outputSelection: SELECTION, savedOutputs: new Set(["issue"]), gmailOrigins: new Set([JSON.stringify(ORIGIN)]) },
		}));
		assert.deepEqual(await completion.findCompletion(KEY), { selection: SELECTION, savedOutputs: new Set(["issue"]), origins: [ORIGIN] });
		assert.equal(sent[0].input.ConsistentRead, true);
	});

	it("reads an email with no tracking yet as unselected with nothing saved", async () => {
		const { completion } = store(() => ({ Item: KEY }));
		assert.deepEqual(await completion.findCompletion(KEY), { selection: undefined, savedOutputs: new Set(), origins: [] });
	});

	it("reads a missing email as no completion", async () => {
		const { completion } = store(() => ({}));
		assert.equal(await completion.findCompletion(KEY), undefined);
	});

	it("lists the emails received before a point, newest first, at most 100 at a time", async () => {
		const tracked = {
			...KEY,
			messageId: "<id@example.com>",
			senderEmail: "Dan <dan@news.test>",
			status: "received",
			gmailDestinationAddresses: ["reader-abc123@readplace.com"],
			gmailDeliveryMode: "issue",
			outputSelection: SELECTION,
			savedOutputs: new Set(["issue"]),
			gmailOrigins: new Set([JSON.stringify(ORIGIN), JSON.stringify(ORIGIN)]),
		};
		const untracked = { userId: USER, receivedAtMessageId: "2026-10-26T00:00:00.000Z#<old@example.com>", messageId: "<old@example.com>", senderEmail: "dan@news.test", status: "rejected" };
		const { completion, sent } = store(() => ({ Items: [tracked, untracked], LastEvaluatedKey: { userId: USER } }));

		const listed = await completion.listCompletionsBefore({ userId: USER, before: "2026-10-28T00:00:00.000Z", limit: 500 });

		assert.deepEqual(listed, {
			emails: [
				{
					receivedAtMessageId: RAM,
					messageId: "<id@example.com>",
					senderEmail: "Dan <dan@news.test>",
					status: "received",
					gmailDestinationAddresses: ["reader-abc123@readplace.com"],
					gmailDeliveryMode: "issue",
					selection: SELECTION,
					savedOutputs: new Set(["issue"]),
					origins: [ORIGIN],
				},
				{
					receivedAtMessageId: "2026-10-26T00:00:00.000Z#<old@example.com>",
					messageId: "<old@example.com>",
					senderEmail: "dan@news.test",
					status: "rejected",
					gmailDestinationAddresses: undefined,
					gmailDeliveryMode: undefined,
					selection: undefined,
					savedOutputs: new Set(),
					origins: [],
				},
			],
			exhausted: false,
		});
		assert.deepEqual(
			{
				key: sent[0].input.KeyConditionExpression,
				values: sent[0].input.ExpressionAttributeValues,
				forward: sent[0].input.ScanIndexForward,
				limit: sent[0].input.Limit,
				projection: sent[0].input.ProjectionExpression,
			},
			{
				key: "userId = :uid AND receivedAtMessageId < :before",
				values: { ":uid": USER, ":before": "2026-10-28T00:00:00.000Z" },
				forward: false,
				limit: 100,
				projection: "#messageId, #receivedAtMessageId, #senderEmail, #status, #gmailDestinationAddresses, #gmailDeliveryMode, #outputSelection, #savedOutputs, #gmailOrigins",
			},
		);
	});

	it("reports the list exhausted when no rows remain past the read", async () => {
		const { completion, sent } = store(() => ({ Items: [] }));
		assert.deepEqual(await completion.listCompletionsBefore({ userId: USER, before: RAM, limit: 30 }), { emails: [], exhausted: true });
		assert.equal(sent[0].input.Limit, 30);
	});
});
