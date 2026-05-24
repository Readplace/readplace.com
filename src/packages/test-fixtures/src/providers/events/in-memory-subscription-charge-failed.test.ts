import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionChargeFailed } from "./in-memory-subscription-charge-failed";
import type { UserId } from "@packages/domain/user";

describe("initInMemorySubscriptionChargeFailed", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => { logged.push(args); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishSubscriptionChargeFailed } = initInMemorySubscriptionChargeFailed({ logger });

		await publishSubscriptionChargeFailed({
			userId: "user_abc" as UserId,
			reason: "no_card_on_file",
		});

		assert.equal(logged.length, 1);
	});
});
