import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";

type ConditionFailed = {
	kind: "condition-failed";
	oldItem: Record<string, unknown> | undefined;
	error: ConditionalCheckFailedException;
};

export type ConditionalWriteOutcome<TResult> =
	| { kind: "written"; result: TResult }
	| ConditionFailed;

export async function writeIfCondition<TResult>(
	write: () => Promise<TResult>,
): Promise<ConditionalWriteOutcome<TResult>> {
	try {
		const result = await write();
		return { kind: "written", result };
	} catch (error) {
		if (error instanceof ConditionalCheckFailedException) {
			return { kind: "condition-failed", oldItem: error.Item, error };
		}
		throw error;
	}
}

export type TransactionOutcome =
	| { kind: "written" }
	| { kind: "condition-failed" };

export async function transactIfConditions(
	write: () => Promise<unknown>,
): Promise<TransactionOutcome> {
	try {
		await write();
		return { kind: "written" };
	} catch (error) {
		if (
			error instanceof TransactionCanceledException &&
			error.CancellationReasons?.some(
				(reason) => reason.Code === "ConditionalCheckFailed",
			)
		) {
			return { kind: "condition-failed" };
		}
		throw error;
	}
}
