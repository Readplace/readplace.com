import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryAddPaymentMethodCommand } from "./in-memory-add-payment-method-command";
import type { UserId } from "@packages/domain/user";

describe("initInMemoryAddPaymentMethodCommand", () => {
	it("logs and completes without throwing", async () => {
		const logged: unknown[] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => { logged.push(args); },
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishAddPaymentMethodCommand } = initInMemoryAddPaymentMethodCommand({ logger });

		await publishAddPaymentMethodCommand({
			userId: "user_abc" as UserId,
			customerId: "cus_test",
			paymentMethodId: "pm_test",
			brand: "visa",
			last4: "4242",
		});

		assert.equal(logged.length, 1);
	});
});
