import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionChargeSucceeded } from "./in-memory-subscription-charge-succeeded";
import type { UserId } from "@packages/domain/user";

describe("initInMemorySubscriptionChargeSucceeded", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => { logged.push(args); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishSubscriptionChargeSucceeded } = initInMemorySubscriptionChargeSucceeded({ logger });

		await publishSubscriptionChargeSucceeded({
			userId: "user_abc" as UserId,
			subscriptionId: "sub_123",
			customerId: "cus_456",
		});

		assert.equal(logged.length, 1);
	});
});
