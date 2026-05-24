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
});
