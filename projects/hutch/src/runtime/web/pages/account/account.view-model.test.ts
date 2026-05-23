import assert from "node:assert/strict";
import { toAccountViewModel, parseAccountQuery } from "./account.view-model";
import type { EffectiveAccess } from "../../../domain/access/effective-access";

const ONE_DAY_MS = 86_400_000;

describe("toAccountViewModel", () => {
	it("confirm=cancel falls through to trial-countdown when user is trialing", () => {
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, confirmCancel: true, errorPaymentMethod: false },
			new Date(),
		);
		assert.equal(vm.state, "trial");
	});

	it("confirm=cancel falls through to founding when user is founding member", () => {
		const access: EffectiveAccess = {
			tier: "founding",
			access: "full",
			banner: "none",
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, confirmCancel: true, errorPaymentMethod: false },
			new Date(),
		);
		assert.equal(vm.state, "founding");
	});

	it("shows singular 'day' when trial ends in less than 24 hours", () => {
		const now = new Date("2026-05-23T12:00:00Z");
		const trialEndsAt = new Date("2026-05-24T00:00:00Z").toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, confirmCancel: false, errorPaymentMethod: false },
			now,
		);
		assert.equal(vm.trialDaysLeft, 1);
		assert.equal(vm.trialDaysLeftWord, "day");
	});

	it("shows zero-remainder day boundary correctly", () => {
		const now = new Date("2026-05-23T00:00:00.000Z");
		const trialEndsAt = new Date("2026-05-24T00:00:00.000Z").toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, confirmCancel: false, errorPaymentMethod: false },
			now,
		);
		assert.equal(vm.trialDaysLeft, 1);
		assert.equal(vm.trialDaysLeftWord, "day");
	});
});

describe("parseAccountQuery", () => {
	it("returns defaults for undefined query", () => {
		const result = parseAccountQuery(undefined);
		assert.deepEqual(result, {
			cancelling: false,
			confirmCancel: false,
			errorPaymentMethod: false,
		});
	});
});
