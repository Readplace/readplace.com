import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionCancelled } from "./in-memory-subscription-cancelled";
import type { UserId } from "@packages/domain/user";

describe("initInMemorySubscriptionCancelled", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => { logged.push(args); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishSubscriptionCancelled } = initInMemorySubscriptionCancelled({ logger });

		await publishSubscriptionCancelled({
			userId: "user_abc" as UserId,
			subscriptionId: "sub_123",
			reason: "stripe_webhook",
		});

		assert.equal(logged.length, 1);
	});

	it("works without optional subscriptionId", async () => {
		const { publishSubscriptionCancelled } = initInMemorySubscriptionCancelled({
			logger: HutchLogger.from(noopLogger),
		});

		await assert.doesNotReject(
			publishSubscriptionCancelled({
				userId: "user_xyz" as UserId,
				reason: "user_initiated_trial",
			}),
		);
	});
});
