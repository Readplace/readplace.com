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

	it("records create + delete trial-feedback-email calls independently of the other schedule kinds", async () => {
		const userIdA = UserIdSchema.parse("1".repeat(32));
		const userIdB = UserIdSchema.parse("2".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await scheduler.createTrialFeedbackEmailSchedule({
			userId: userIdA,
			firesAt: "2026-06-08T00:00:00.000Z",
		});
		await scheduler.createTrialFeedbackEmailSchedule({
			userId: userIdB,
			firesAt: "2026-06-09T00:00:00.000Z",
		});

		assert.equal(
			scheduler.getTrialFeedbackEmailSchedule(userIdA),
			"2026-06-08T00:00:00.000Z",
		);
		assert.deepEqual(scheduler.allTrialFeedbackEmailSchedules(), [
			{ userId: userIdA, firesAt: "2026-06-08T00:00:00.000Z" },
			{ userId: userIdB, firesAt: "2026-06-09T00:00:00.000Z" },
		]);
		// The other two schedule kinds remain untouched.
		assert.deepEqual(scheduler.allSchedules(), []);
		assert.deepEqual(scheduler.allDeferredCancellationSchedules(), []);

		await scheduler.deleteTrialFeedbackEmailSchedule({ userId: userIdA });

		assert.equal(scheduler.getTrialFeedbackEmailSchedule(userIdA), undefined);
		assert.deepEqual(scheduler.trialFeedbackEmailDeleteCalls(), [userIdA]);
	});

	it("createTrialFeedbackEmailSchedule overwrites an existing schedule for the same user (idempotent on duplicate events)", async () => {
		const userId = UserIdSchema.parse("3".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await scheduler.createTrialFeedbackEmailSchedule({
			userId,
			firesAt: "2026-06-08T00:00:00.000Z",
		});
		await scheduler.createTrialFeedbackEmailSchedule({
			userId,
			firesAt: "2026-06-10T00:00:00.000Z",
		});

		assert.equal(
			scheduler.getTrialFeedbackEmailSchedule(userId),
			"2026-06-10T00:00:00.000Z",
		);
		assert.equal(scheduler.allTrialFeedbackEmailSchedules().length, 1);
	});

	it("deleteTrialFeedbackEmailSchedule is idempotent on a missing schedule", async () => {
		const userId = UserIdSchema.parse("4".repeat(32));
		const scheduler = initInMemoryTrialScheduler();

		await assert.doesNotReject(scheduler.deleteTrialFeedbackEmailSchedule({ userId }));
		assert.deepEqual(scheduler.trialFeedbackEmailDeleteCalls(), [userId]);
	});

	it("createTrialFeedbackEmailSchedule throws when configured to fail", async () => {
		const userId = UserIdSchema.parse("5".repeat(32));
		const scheduler = initInMemoryTrialScheduler({
			createTrialFeedbackEmailFails: true,
		});

		await assert.rejects(
			() =>
				scheduler.createTrialFeedbackEmailSchedule({
					userId,
					firesAt: "2026-06-08T00:00:00.000Z",
				}),
			/In-memory trial-feedback-email create failure/,
		);
		assert.equal(scheduler.getTrialFeedbackEmailSchedule(userId), undefined);
	});
});
