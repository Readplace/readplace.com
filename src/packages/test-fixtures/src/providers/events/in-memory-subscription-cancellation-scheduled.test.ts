import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionCancellationScheduled } from "./in-memory-subscription-cancellation-scheduled";
import type { UserId } from "@packages/domain/user";

describe("initInMemorySubscriptionCancellationScheduled", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => {
				logged.push(args);
			},
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishSubscriptionCancellationScheduled } =
			initInMemorySubscriptionCancellationScheduled({ logger });

		await publishSubscriptionCancellationScheduled({
			userId: "user_abc" as UserId,
			subscriptionId: "sub_123",
			cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
		});

		assert.equal(logged.length, 1);
	});

	it("works without optional subscriptionId (trial cancel path)", async () => {
		const { publishSubscriptionCancellationScheduled } =
			initInMemorySubscriptionCancellationScheduled({
				logger: HutchLogger.from(noopLogger),
			});

		await assert.doesNotReject(
			publishSubscriptionCancellationScheduled({
				userId: "user_xyz" as UserId,
				cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
			}),
		);
	});
});
