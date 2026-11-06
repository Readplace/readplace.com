import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/storage-client";
import { initDynamoDbTranscriptCharge, initDynamoDbTranscriptLedger } from "./dynamodb-transcript-quota";

type SendFn = DynamoDBDocumentClient["send"];

type Sent = { name: string; input: Record<string, unknown> };

function recordingClient(outcomes: unknown[] = []) {
	const sent: Sent[] = [];
	const send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		sent.push({ name: command.constructor.name, input: command.input });
		const outcome = outcomes[sent.length - 1] ?? {};
		if (outcome instanceof Error) throw outcome;
		return outcome;
	}) as unknown as SendFn;
	const client: Partial<DynamoDBDocumentClient> = { send };
	return { client: client as DynamoDBDocumentClient, sent };
}

function cancelled(reasons: { Code: string; Item?: Record<string, { S: string }> }[]): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "transaction cancelled",
		CancellationReasons: reasons,
	});
}

function conditionFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" });
}

const TABLE = "media";
const REF = { userId: "user-1", uploadId: "upload-1", attempt: 1 };
const CHARGED = { ...REF, seconds: 600, day: "2026-11-06" };
const CHARGE_KEY = { pk: "quota#user-1", sk: "charge#upload-1#1" };
const DAY_KEY = { pk: "quota#user-1", sk: "day#2026-11-06" };
const noDelay = async () => {};
const at = (iso: string) => () => new Date(iso);

function charge(options: { outcomes?: unknown[]; now?: () => Date } = {}) {
	const { client, sent } = recordingClient(options.outcomes);
	const { chargeTranscriptQuota } = initDynamoDbTranscriptCharge({
		client,
		tableName: TABLE,
		allowanceSeconds: 1250,
		now: options.now ?? at("2026-11-06T10:00:00.000Z"),
		delay: noDelay,
	});
	return { chargeTranscriptQuota, sent };
}

function ledger(outcomes: unknown[] = []) {
	const { client, sent } = recordingClient(outcomes);
	const delays: number[] = [];
	const ports = initDynamoDbTranscriptLedger({
		client,
		tableName: TABLE,
		now: at("2026-11-06T10:00:00.000Z"),
		delay: async (milliseconds) => {
			delays.push(milliseconds);
		},
	});
	return { ...ports, sent, delays };
}

describe("initDynamoDbTranscriptCharge", () => {
	it("reserves the charge row and adds the seconds to the day row under the allowance in one transaction", async () => {
		const { chargeTranscriptQuota, sent } = charge();

		const result = await chargeTranscriptQuota({ ...REF, seconds: 600 });

		assert.deepEqual(result, { outcome: "charged", day: "2026-11-06" });
		const chargedAtSeconds = Date.parse("2026-11-06T10:00:00.000Z") / 1000;
		assert.deepEqual(sent, [
			{
				name: "TransactWriteCommand",
				input: {
					TransactItems: [
						{
							Put: {
								TableName: TABLE,
								Item: {
									...CHARGE_KEY,
									seconds: 600,
									state: "reserved",
									day: "2026-11-06",
									chargedAt: "2026-11-06T10:00:00.000Z",
									expiresAt: chargedAtSeconds + 14 * 86_400,
								},
								ConditionExpression: "attribute_not_exists(sk) OR #state = :refunded",
								ExpressionAttributeNames: { "#state": "state" },
								ExpressionAttributeValues: { ":refunded": "refunded" },
							},
						},
						{
							Update: {
								TableName: TABLE,
								Key: DAY_KEY,
								UpdateExpression:
									"ADD spentSeconds :seconds SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
								ConditionExpression: "attribute_not_exists(spentSeconds) OR spentSeconds <= :maxBefore",
								ExpressionAttributeValues: {
									":seconds": 600,
									":maxBefore": 650,
									":expiresAt": Date.parse("2026-11-06T00:00:00.000Z") / 1000 + 2 * 86_400,
								},
							},
						},
					],
				},
			},
		]);
	});

	it("charges the day the injected clock is on, either side of midnight UTC", async () => {
		const late = charge({ now: at("2026-11-06T23:59:59.000Z") });
		const early = charge({ now: at("2026-11-07T00:00:00.000Z") });

		await late.chargeTranscriptQuota({ ...REF, seconds: 60 });
		await early.chargeTranscriptQuota({ ...REF, seconds: 60 });

		const dayKeyOf = (sent: Sent[]) =>
			(sent[0]?.input.TransactItems as { Update?: { Key: unknown } }[])[1]?.Update?.Key;
		assert.deepEqual(dayKeyOf(late.sent), DAY_KEY);
		assert.deepEqual(dayKeyOf(early.sent), { pk: "quota#user-1", sk: "day#2026-11-07" });
	});

	it("refuses a file longer than the whole allowance without writing", async () => {
		const { chargeTranscriptQuota, sent } = charge();

		const result = await chargeTranscriptQuota({ ...REF, seconds: 1251 });

		assert.deepEqual(result, { outcome: "over-allowance" });
		assert.deepEqual(sent, []);
	});

	it("answers already-charged when the charge row condition fails", async () => {
		const { chargeTranscriptQuota } = charge({
			outcomes: [cancelled([{ Code: "ConditionalCheckFailed" }, { Code: "None" }])],
		});

		assert.deepEqual(await chargeTranscriptQuota({ ...REF, seconds: 600 }), { outcome: "already-charged" });
	});

	it("answers day-spent when the day row condition fails", async () => {
		const { chargeTranscriptQuota } = charge({
			outcomes: [cancelled([{ Code: "None" }, { Code: "ConditionalCheckFailed" }])],
		});

		assert.deepEqual(await chargeTranscriptQuota({ ...REF, seconds: 600 }), { outcome: "day-spent" });
	});

	it("retries a transaction conflict and charges once the conflict clears", async () => {
		const conflict = cancelled([{ Code: "None" }, { Code: "TransactionConflict" }]);
		const { chargeTranscriptQuota, sent } = charge({ outcomes: [conflict, {}] });

		assert.deepEqual(await chargeTranscriptQuota({ ...REF, seconds: 600 }), {
			outcome: "charged",
			day: "2026-11-06",
		});
		assert.equal(sent.length, 2);
	});

	it("throws after three conflicted attempts", async () => {
		const conflict = cancelled([{ Code: "None" }, { Code: "TransactionConflict" }]);
		const { chargeTranscriptQuota, sent } = charge({ outcomes: [conflict, conflict, conflict] });

		await assert.rejects(chargeTranscriptQuota({ ...REF, seconds: 600 }), TransactionCanceledException);
		assert.equal(sent.length, 3);
	});

	it("rethrows a cancellation that is neither a condition nor a conflict", async () => {
		const { chargeTranscriptQuota, sent } = charge({
			outcomes: [cancelled([{ Code: "None" }, { Code: "ThrottlingError" }])],
		});

		await assert.rejects(chargeTranscriptQuota({ ...REF, seconds: 600 }), TransactionCanceledException);
		assert.equal(sent.length, 1);
	});

	it("rethrows an error that is not a cancellation", async () => {
		const { chargeTranscriptQuota } = charge({ outcomes: [new Error("network down")] });

		await assert.rejects(chargeTranscriptQuota({ ...REF, seconds: 600 }), /network down/);
	});
});

describe("initDynamoDbTranscriptLedger", () => {
	describe.each([
		["markTranscriptStarted", "started"],
		["settleTranscriptCharge", "settled"],
	] as const)("%s", (port, to) => {
		it(`moves an open charge to ${to} with one conditional update`, async () => {
			const subject = ledger();

			assert.deepEqual(await subject[port](REF), { outcome: "done" });
			assert.deepEqual(subject.sent, [
				{
					name: "UpdateCommand",
					input: {
						TableName: TABLE,
						Key: CHARGE_KEY,
						UpdateExpression: "SET #state = :to",
						ConditionExpression: "#state IN (:reserved, :started)",
						ExpressionAttributeNames: { "#state": "state" },
						ExpressionAttributeValues: { ":to": to, ":reserved": "reserved", ":started": "started" },
					},
				},
			]);
		});

		it("answers closed for a settled, refunded or missing charge row", async () => {
			const subject = ledger([conditionFailed()]);

			assert.deepEqual(await subject[port](REF), { outcome: "closed" });
			assert.equal(subject.sent.length, 1);
		});

		it("rethrows any other error", async () => {
			const subject = ledger([new Error("network down")]);

			await assert.rejects(subject[port](REF), /network down/);
		});
	});

	describe("refundTranscriptCharge", () => {
		it("refunds a reserved or started charge and gives its seconds back to the charged day", async () => {
			const subject = ledger();

			assert.deepEqual(await subject.refundTranscriptCharge(CHARGED), { outcome: "refunded" });
			assert.deepEqual(subject.sent, [
				{
					name: "TransactWriteCommand",
					input: {
						TransactItems: [
							{
								Update: {
									TableName: TABLE,
									Key: CHARGE_KEY,
									UpdateExpression: "SET #state = :refunded",
									ConditionExpression: "#state IN (:reserved, :started)",
									ExpressionAttributeNames: { "#state": "state" },
									ExpressionAttributeValues: {
										":refunded": "refunded",
										":reserved": "reserved",
										":started": "started",
									},
								},
							},
							{
								Update: {
									TableName: TABLE,
									Key: DAY_KEY,
									UpdateExpression:
										"ADD spentSeconds :refund SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
									ExpressionAttributeValues: {
										":refund": -600,
										":expiresAt": Date.parse("2026-11-06T00:00:00.000Z") / 1000 + 2 * 86_400,
									},
								},
							},
						],
					},
				},
			]);
		});

		it("answers closed for a settled or missing charge row", async () => {
			const subject = ledger([cancelled([{ Code: "ConditionalCheckFailed" }, { Code: "None" }])]);

			assert.deepEqual(await subject.refundTranscriptCharge(CHARGED), { outcome: "closed" });
			assert.equal(subject.sent.length, 1);
		});

		it("retries a conflict on the charge item three times and then throws", async () => {
			const conflict = cancelled([{ Code: "TransactionConflict" }, { Code: "None" }]);
			const subject = ledger([conflict, conflict, conflict]);

			await assert.rejects(subject.refundTranscriptCharge(CHARGED), TransactionCanceledException);
			assert.equal(subject.sent.length, 3);
			assert.equal(subject.delays.length, 2);
		});
	});

	describe("refundUnstartedCharge", () => {
		it("refunds a reserved charge, conditioned on reserved and asking for the old row on failure", async () => {
			const subject = ledger();

			assert.deepEqual(await subject.refundUnstartedCharge(CHARGED), { outcome: "refunded" });
			const [chargeItem] = subject.sent[0]?.input.TransactItems as { Update: Record<string, unknown> }[];
			assert.deepEqual(chargeItem?.Update, {
				TableName: TABLE,
				Key: CHARGE_KEY,
				UpdateExpression: "SET #state = :refunded",
				ConditionExpression: "#state = :reserved",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: { ":refunded": "refunded", ":reserved": "reserved" },
				ReturnValuesOnConditionCheckFailure: "ALL_OLD",
			});
		});

		it("answers started when the returned row is started", async () => {
			const subject = ledger([
				cancelled([{ Code: "ConditionalCheckFailed", Item: { state: { S: "started" } } }, { Code: "None" }]),
			]);

			assert.deepEqual(await subject.refundUnstartedCharge(CHARGED), { outcome: "started" });
		});

		it.each(["settled", "refunded"])("answers closed when the returned row is %s", async (state) => {
			const subject = ledger([
				cancelled([{ Code: "ConditionalCheckFailed", Item: { state: { S: state } } }, { Code: "None" }]),
			]);

			assert.deepEqual(await subject.refundUnstartedCharge(CHARGED), { outcome: "closed" });
		});

		it("answers closed for a missing charge row with one transaction sent", async () => {
			const subject = ledger([cancelled([{ Code: "ConditionalCheckFailed" }, { Code: "None" }])]);

			assert.deepEqual(await subject.refundUnstartedCharge(CHARGED), { outcome: "closed" });
			assert.equal(subject.sent.length, 1);
		});

		it("retries a conflict on the charge item three times and then throws", async () => {
			const conflict = cancelled([{ Code: "TransactionConflict" }, { Code: "None" }]);
			const subject = ledger([conflict, conflict, conflict]);

			await assert.rejects(subject.refundUnstartedCharge(CHARGED), TransactionCanceledException);
			assert.equal(subject.sent.length, 3);
		});
	});

	describe("deleteAllTranscriptQuota", () => {
		it("queries every page of the reader's rows and deletes each returned key", async () => {
			const subject = ledger([
				{ Items: [DAY_KEY], LastEvaluatedKey: DAY_KEY },
				{},
				{ Items: [CHARGE_KEY] },
				{},
			]);

			await subject.deleteAllTranscriptQuota({ userId: "user-1" });

			const query = {
				name: "QueryCommand",
				input: {
					TableName: TABLE,
					KeyConditionExpression: "pk = :pk",
					ExpressionAttributeValues: { ":pk": "quota#user-1" },
				},
			};
			assert.deepEqual(subject.sent, [
				{ ...query, input: { ...query.input, ExclusiveStartKey: undefined } },
				{ name: "DeleteCommand", input: { TableName: TABLE, Key: DAY_KEY } },
				{ ...query, input: { ...query.input, ExclusiveStartKey: DAY_KEY } },
				{ name: "DeleteCommand", input: { TableName: TABLE, Key: CHARGE_KEY } },
			]);
		});

		it("writes nothing when the reader has no rows", async () => {
			const subject = ledger([{ Items: [] }]);

			await subject.deleteAllTranscriptQuota({ userId: "user-1" });

			assert.deepEqual(
				subject.sent.map((command) => command.name),
				["QueryCommand"],
			);
		});
	});
});
