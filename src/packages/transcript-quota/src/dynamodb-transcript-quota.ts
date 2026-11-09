import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	defineDynamoTable,
	forEachQueryPage,
	writeIfCondition,
} from "@packages/storage-client";
import type {
	ChargeTranscriptQuota,
	ChargedTranscript,
	DeleteAllTranscriptQuota,
	MarkTranscriptStarted,
	RefundTranscriptCharge,
	RefundUnstartedCharge,
	SettleTranscriptCharge,
	TranscriptChargeRef,
} from "@packages/provider-contracts/transcript-quota";
import { z } from "zod";
import {
	LedgerKeySchema,
	chargeRowKey,
	chargeRowOf,
	dayRowExpiresAt,
	dayRowKey,
	quotaPk,
} from "./ledger-rows";

const MAX_TRANSACT_ATTEMPTS = 3;
const CONFLICT_RETRY_BASE_DELAY_MS = 50;

const ReturnedChargeStateSchema = z.object({
	state: z.object({ S: z.enum(["started", "settled", "refunded"]) }),
});

const ReturnedChargeDaySchema = z.object({ day: z.object({ S: z.string() }) });

type LedgerDeps = {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
	delay: (milliseconds: number) => Promise<void>;
};

function cancellationCodes(error: TransactionCanceledException): (string | undefined)[] {
	assert(error.CancellationReasons, "a cancelled transaction names a reason for each item");
	return error.CancellationReasons.map((reason) => reason.Code);
}

function initTransact(deps: LedgerDeps) {
	return async function transact<T>(p: {
		input: ConstructorParameters<typeof TransactWriteCommand>[0];
		onCancelled: (error: TransactionCanceledException) => T | undefined;
		attempt?: number;
	}): Promise<T | "written"> {
		const attempt = p.attempt ?? 1;
		try {
			await deps.client.send(new TransactWriteCommand(p.input));
			return "written";
		} catch (error) {
			if (!(error instanceof TransactionCanceledException)) throw error;
			const decided = p.onCancelled(error);
			if (decided !== undefined) return decided;
			const conflicted = cancellationCodes(error).includes("TransactionConflict");
			if (!conflicted || attempt >= MAX_TRANSACT_ATTEMPTS) throw error;
			await deps.delay(Math.random() * CONFLICT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
			return transact({ ...p, attempt: attempt + 1 });
		}
	};
}

export function initDynamoDbTranscriptCharge(deps: LedgerDeps & { allowanceSeconds: number }): {
	chargeTranscriptQuota: ChargeTranscriptQuota;
} {
	const transact = initTransact(deps);

	const chargeTranscriptQuota: ChargeTranscriptQuota = async ({ userId, uploadId, attempt, seconds }) => {
		assert(Number.isInteger(seconds) && seconds > 0, "a transcript charge is a positive whole number of seconds");
		if (seconds > deps.allowanceSeconds) return { outcome: "over-allowance" };
		const charge = chargeRowOf({ userId, uploadId, attempt, seconds, now: deps.now() });
		const result = await transact({
			input: {
				TransactItems: [
					{
						Put: {
							TableName: deps.tableName,
							Item: charge,
							ConditionExpression: "attribute_not_exists(sk) OR #state = :refunded",
							ExpressionAttributeNames: { "#state": "state" },
							ExpressionAttributeValues: { ":refunded": "refunded" },
							ReturnValuesOnConditionCheckFailure: "ALL_OLD",
						},
					},
					{
						Update: {
							TableName: deps.tableName,
							Key: dayRowKey({ userId, day: charge.day }),
							UpdateExpression:
								"ADD spentSeconds :seconds SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
							ConditionExpression: "attribute_not_exists(spentSeconds) OR spentSeconds <= :maxBefore",
							ExpressionAttributeValues: {
								":seconds": seconds,
								":maxBefore": deps.allowanceSeconds - seconds,
								":expiresAt": dayRowExpiresAt(charge.day),
							},
						},
					},
				],
			},
			onCancelled: (error) => {
				const [chargeCode, dayCode] = cancellationCodes(error);
				if (chargeCode === "ConditionalCheckFailed") {
					const { day } = ReturnedChargeDaySchema.parse(error.CancellationReasons?.[0]?.Item);
					return { outcome: "already-charged" as const, day: day.S };
				}
				if (dayCode === "ConditionalCheckFailed") return { outcome: "day-spent" as const };
				return undefined;
			},
		});
		return result === "written" ? { outcome: "charged", day: charge.day } : result;
	};

	return { chargeTranscriptQuota };
}

export function initDynamoDbTranscriptLedger(deps: LedgerDeps): {
	markTranscriptStarted: MarkTranscriptStarted;
	settleTranscriptCharge: SettleTranscriptCharge;
	refundTranscriptCharge: RefundTranscriptCharge;
	refundUnstartedCharge: RefundUnstartedCharge;
	deleteAllTranscriptQuota: DeleteAllTranscriptQuota;
} {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: LedgerKeySchema });
	const transact = initTransact(deps);

	const moveOpenCharge = async (p: {
		ref: TranscriptChargeRef;
		to: "started" | "settled";
	}): Promise<{ outcome: "done" } | { outcome: "closed" }> => {
		const written = await writeIfCondition(() =>
			table.update({
				Key: chargeRowKey(p.ref),
				UpdateExpression: "SET #state = :to",
				ConditionExpression: "#state IN (:reserved, :started)",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: { ":to": p.to, ":reserved": "reserved", ":started": "started" },
			}),
		);
		return written.kind === "written" ? { outcome: "done" } : { outcome: "closed" };
	};

	const refundInput = (p: {
		charge: ChargedTranscript;
		chargeCondition: { expression: string; values: Record<string, string> };
		returnOnFailure: boolean;
	}): ConstructorParameters<typeof TransactWriteCommand>[0] => ({
		TransactItems: [
			{
				Update: {
					TableName: deps.tableName,
					Key: chargeRowKey(p.charge),
					UpdateExpression: "SET #state = :refunded",
					ConditionExpression: p.chargeCondition.expression,
					ExpressionAttributeNames: { "#state": "state" },
					ExpressionAttributeValues: { ":refunded": "refunded", ...p.chargeCondition.values },
					...(p.returnOnFailure ? { ReturnValuesOnConditionCheckFailure: "ALL_OLD" as const } : {}),
				},
			},
			{
				Update: {
					TableName: deps.tableName,
					Key: dayRowKey({ userId: p.charge.userId, day: p.charge.day }),
					UpdateExpression: "ADD spentSeconds :refund SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
					ExpressionAttributeValues: {
						":refund": -p.charge.seconds,
						":expiresAt": dayRowExpiresAt(p.charge.day),
					},
				},
			},
		],
	});

	const refundTranscriptCharge: RefundTranscriptCharge = async (charge) => {
		const result = await transact({
			input: refundInput({ charge, chargeCondition: {
					expression: "#state IN (:reserved, :started)",
					values: { ":reserved": "reserved", ":started": "started" },
				}, returnOnFailure: false }),
			onCancelled: (error) =>
				cancellationCodes(error)[0] === "ConditionalCheckFailed" ? { outcome: "closed" as const } : undefined,
		});
		return result === "written" ? { outcome: "refunded" } : result;
	};

	const refundUnstartedCharge: RefundUnstartedCharge = async (charge) => {
		const result = await transact({
			input: refundInput({ charge, chargeCondition: { expression: "#state = :reserved", values: { ":reserved": "reserved" } }, returnOnFailure: true }),
			onCancelled: (error) => {
				const chargeReason = error.CancellationReasons?.[0];
				if (chargeReason?.Code !== "ConditionalCheckFailed") return undefined;
				if (!chargeReason.Item) return { outcome: "closed" as const };
				const { state } = ReturnedChargeStateSchema.parse(chargeReason.Item);
				return state.S === "started" ? { outcome: "started" as const } : { outcome: "closed" as const };
			},
		});
		return result === "written" ? { outcome: "refunded" } : result;
	};

	const deleteAllTranscriptQuota: DeleteAllTranscriptQuota = async ({ userId }) => {
		await forEachQueryPage(
			table,
			{ KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": quotaPk(userId) } },
			async (rows) => {
				for (const row of rows) {
					await table.delete({ Key: { pk: row.pk, sk: row.sk } });
				}
			},
		);
	};

	return {
		markTranscriptStarted: (ref) => moveOpenCharge({ ref, to: "started" }),
		settleTranscriptCharge: (ref) => moveOpenCharge({ ref, to: "settled" }),
		refundTranscriptCharge,
		refundUnstartedCharge,
		deleteAllTranscriptQuota,
	};
}
