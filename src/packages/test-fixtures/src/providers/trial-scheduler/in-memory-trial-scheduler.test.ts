import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryTrialScheduler } from "./in-memory-trial-scheduler";

describe("initInMemoryTrialScheduler", () => {
	it("records create + delete calls for assertion", async () => {
		const userIdA = UserIdSchema.parse("a".repeat(32));
		const userIdB = UserIdSchema.parse("b".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await scheduler.createTrialEndSchedule({
			userId: userIdA,
			firesAt: "2026-06-06T00:00:00.000Z",
		});
		await scheduler.createTrialEndSchedule({
			userId: userIdB,
			firesAt: "2026-06-07T00:00:00.000Z",
		});

		assert.equal(scheduler.getSchedule(userIdA), "2026-06-06T00:00:00.000Z");
		assert.deepEqual(scheduler.allSchedules(), [
			{ userId: userIdA, firesAt: "2026-06-06T00:00:00.000Z" },
			{ userId: userIdB, firesAt: "2026-06-07T00:00:00.000Z" },
		]);

		await scheduler.deleteTrialEndSchedule({ userId: userIdA });
		assert.equal(scheduler.getSchedule(userIdA), undefined);
		assert.deepEqual(scheduler.deleteCalls(), [userIdA]);
	});

	it("delete is idempotent — calling delete on a missing schedule does not throw", async () => {
		const userId = UserIdSchema.parse("c".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await assert.doesNotReject(scheduler.deleteTrialEndSchedule({ userId }));
		assert.deepEqual(scheduler.deleteCalls(), [userId]);
	});

	it("createTrialEndSchedule throws when configured to fail", async () => {
		const userId = UserIdSchema.parse("d".repeat(32));
		const scheduler = initInMemoryTrialScheduler({ createFails: true });

		await assert.rejects(
			() => scheduler.createTrialEndSchedule({ userId, firesAt: "2026-06-06T00:00:00.000Z" }),
			/In-memory trial-scheduler create failure/,
		);
		assert.equal(scheduler.getSchedule(userId), undefined);
	});

	it("records create + delete deferred-cancellation calls independently of trial-end schedules", async () => {
		const userIdA = UserIdSchema.parse("e".repeat(32));
		const userIdB = UserIdSchema.parse("f".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await scheduler.createDeferredCancellationSchedule({
			userId: userIdA,
			firesAt: "2026-06-22T11:00:00.000Z",
		});
		await scheduler.createDeferredCancellationSchedule({
			userId: userIdB,
			firesAt: "2026-06-23T11:00:00.000Z",
		});

		assert.equal(
			scheduler.getDeferredCancellationSchedule(userIdA),
			"2026-06-22T11:00:00.000Z",
		);
		assert.deepEqual(scheduler.allDeferredCancellationSchedules(), [
			{ userId: userIdA, firesAt: "2026-06-22T11:00:00.000Z" },
			{ userId: userIdB, firesAt: "2026-06-23T11:00:00.000Z" },
		]);
		// Trial-end schedules unaffected — the two schedule kinds are independent.
		assert.deepEqual(scheduler.allSchedules(), []);

		await scheduler.deleteDeferredCancellationSchedule({ userId: userIdA });

		assert.equal(scheduler.getDeferredCancellationSchedule(userIdA), undefined);
		assert.deepEqual(scheduler.deferredCancellationDeleteCalls(), [userIdA]);
	});

	it("deleteDeferredCancellationSchedule is idempotent on a missing schedule", async () => {
		const userId = UserIdSchema.parse("9".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await assert.doesNotReject(scheduler.deleteDeferredCancellationSchedule({ userId }));
		assert.deepEqual(scheduler.deferredCancellationDeleteCalls(), [userId]);
	});

	it("createDeferredCancellationSchedule throws when configured to fail", async () => {
		const userId = UserIdSchema.parse("8".repeat(32));
		const scheduler = initInMemoryTrialScheduler({
			createDeferredCancellationFails: true,
		});

		await assert.rejects(
			() =>
				scheduler.createDeferredCancellationSchedule({
					userId,
					firesAt: "2026-06-22T11:00:00.000Z",
				}),
			/In-memory deferred-cancellation create failure/,
		);
		assert.equal(scheduler.getDeferredCancellationSchedule(userId), undefined);
	});
});
