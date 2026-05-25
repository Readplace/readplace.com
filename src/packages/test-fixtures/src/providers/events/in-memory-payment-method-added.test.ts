import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryPaymentMethodAdded } from "./in-memory-payment-method-added";
import type { UserId } from "@packages/domain/user";

describe("initInMemoryPaymentMethodAdded", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => { logged.push(args); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishPaymentMethodAdded } = initInMemoryPaymentMethodAdded({ logger });

		await publishPaymentMethodAdded({ userId: "user_abc" as UserId });

		assert.equal(logged.length, 1);
	});
});
