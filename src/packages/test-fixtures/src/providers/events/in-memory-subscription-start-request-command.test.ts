import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionStartRequestCommand } from "./in-memory-subscription-start-request-command";
import type { UserId } from "@packages/domain/user";

describe("initInMemorySubscriptionStartRequestCommand", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => { logged.push(args); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishSubscriptionStartRequestCommand } = initInMemorySubscriptionStartRequestCommand({ logger });

		await publishSubscriptionStartRequestCommand({
			userId: "user_abc" as UserId,
		});

		assert.equal(logged.length, 1);
	});
});
