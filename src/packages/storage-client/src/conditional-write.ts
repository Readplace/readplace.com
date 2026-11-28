import {
	type CancellationReason,
	ConditionalCheckFailedException,
	TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

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

const CONFLICT_RETRY_BASE_DELAY_MS = 50;

export type CancellationDecision<T> = { handled: true; value: T } | { handled: false };

export type ConflictRetryOutcome<T> = { kind: "written" } | { kind: "decided"; value: T };

export async function transactWithConflictRetry<T>(p: {
	client: Pick<DynamoDBDocumentClient, "send">;
	delay: (milliseconds: number) => Promise<void>;
	maxAttempts: number;
	input: TransactWriteCommandInput;
	onCancelled: (reasons: readonly CancellationReason[]) => Promise<CancellationDecision<T>>;
}): Promise<ConflictRetryOutcome<T>> {
	for (let attempt = 1; ; attempt++) {
		try {
			await p.client.send(new TransactWriteCommand(p.input));
			return { kind: "written" };
		} catch (error) {
			if (!(error instanceof TransactionCanceledException)) throw error;
			const reasons = error.CancellationReasons ?? [];
			const decision = await p.onCancelled(reasons);
			if (decision.handled) return { kind: "decided", value: decision.value };
			const conflicted = reasons.some((reason) => reason.Code === "TransactionConflict");
			if (!conflicted || attempt >= p.maxAttempts) throw error;
			await p.delay(Math.random() * CONFLICT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
		}
	}
}
