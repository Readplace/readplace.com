import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionReactivated } from "./in-memory-subscription-reactivated";
import type { UserId } from "@packages/domain/user";

describe("initInMemorySubscriptionReactivated", () => {
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
		const { publishSubscriptionReactivated } = initInMemorySubscriptionReactivated({ logger });

		await publishSubscriptionReactivated({
			userId: "user_abc" as UserId,
			subscriptionId: "sub_123",
		});

		assert.equal(logged.length, 1);
	});

	it("works without optional subscriptionId (trial reactivate path)", async () => {
		const { publishSubscriptionReactivated } = initInMemorySubscriptionReactivated({
			logger: HutchLogger.from(noopLogger),
		});

		await assert.doesNotReject(
			publishSubscriptionReactivated({ userId: "user_xyz" as UserId }),
		);
	});
});
