import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
} from "./index";
import { transactIfConditions, writeIfCondition } from "./conditional-write";

describe("writeIfCondition", () => {
	it("returns the write's result when the write succeeds", async () => {
		const outcome = await writeIfCondition(async () => ({ Attributes: { count: 3 } }));

		assert.deepEqual(outcome, { kind: "written", result: { Attributes: { count: 3 } } });
	});

	it("returns condition-failed with the old item when the condition fails", async () => {
		const error = new ConditionalCheckFailedException({
			message: "The conditional request failed",
			$metadata: {},
			Item: { purgedAt: { S: "2026-11-01T00:00:00.000Z" } },
		});

		const outcome = await writeIfCondition(async () => {
			throw error;
		});

		assert.ok(outcome.kind === "condition-failed");
		assert.deepEqual(outcome.oldItem, { purgedAt: { S: "2026-11-01T00:00:00.000Z" } });
		expect(outcome.error).toBe(error);
	});

	it("returns condition-failed with no old item when the exception carries none", async () => {
		const outcome = await writeIfCondition(async () => {
			throw new ConditionalCheckFailedException({
				message: "The conditional request failed",
				$metadata: {},
			});
		});

		assert.ok(outcome.kind === "condition-failed");
		assert.equal(outcome.oldItem, undefined);
	});

	it("rethrows any other error unchanged", async () => {
		const error = new TransactionCanceledException({
			message: "Transaction cancelled",
			$metadata: {},
			CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
		});

		await expect(
			writeIfCondition(async () => {
				throw error;
			}),
		).rejects.toBe(error);
	});
});

describe("transactIfConditions", () => {
	it("returns written when the transaction succeeds", async () => {
		const outcome = await transactIfConditions(async () => ({}));

		assert.deepEqual(outcome, { kind: "written" });
	});

	it("returns condition-failed when a cancellation reason is a failed condition", async () => {
		const outcome = await transactIfConditions(async () => {
			throw new TransactionCanceledException({
				message: "Transaction cancelled",
				$metadata: {},
				CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
			});
		});

		assert.deepEqual(outcome, { kind: "condition-failed" });
	});

	it("rethrows a cancellation whose reasons hold no failed condition", async () => {
		const error = new TransactionCanceledException({
			message: "Transaction cancelled",
			$metadata: {},
			CancellationReasons: [{ Code: "TransactionConflict" }],
		});

		await expect(
			transactIfConditions(async () => {
				throw error;
			}),
		).rejects.toBe(error);
	});

	it("rethrows a cancellation that carries no reasons", async () => {
		const error = new TransactionCanceledException({
			message: "Transaction cancelled",
			$metadata: {},
		});

		await expect(
			transactIfConditions(async () => {
				throw error;
			}),
		).rejects.toBe(error);
	});

	it("rethrows a plain conditional-check exception, which a transaction never throws", async () => {
		const error = new ConditionalCheckFailedException({
			message: "The conditional request failed",
			$metadata: {},
		});

		await expect(
			transactIfConditions(async () => {
				throw error;
			}),
		).rejects.toBe(error);
	});

	it("rethrows any other error", async () => {
		const error = new Error("throttled");

		await expect(
			transactIfConditions(async () => {
				throw error;
			}),
		).rejects.toBe(error);
	});
});
