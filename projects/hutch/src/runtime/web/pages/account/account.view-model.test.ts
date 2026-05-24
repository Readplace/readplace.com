import assert from "node:assert/strict";
import { toAccountViewModel, parseAccountQuery } from "./account.view-model";
import type { EffectiveAccess } from "../../../domain/access/effective-access";

const ONE_DAY_MS = 86_400_000;

describe("toAccountViewModel — state", () => {
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
			{ cancelling: false, errorPaymentMethod: false },
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
			{ cancelling: false, errorPaymentMethod: false },
			now,
		);
		assert.equal(vm.trialDaysLeft, 1);
		assert.equal(vm.trialDaysLeftWord, "day");
	});
});

describe("toAccountViewModel — actions", () => {
	const now = new Date();
	const baseQuery = { cancelling: false, errorPaymentMethod: false };

	it("founding members get no actions", () => {
		const vm = toAccountViewModel(
			{ tier: "founding", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		assert.deepEqual(vm.actions, []);
	});

	it("active paid users get a destructive cancel form (POST) — no GET confirmation step", () => {
		const vm = toAccountViewModel(
			{ tier: "paid", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		assert.equal(vm.actions.length, 1);
		assert.equal(vm.actions[0].key, "cancel-form");
		assert.equal(vm.actions[0].variant, "destructive");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/cancel");
		assert.equal(vm.actions[0].isLink, false);
	});

	it("trial users get a primary subscribe action only — no cancel button while on trial", () => {
		const trialEndsAt = new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString();
		const vm = toAccountViewModel(
			{ tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["subscribe"]);
		assert.equal(vm.actions[0].variant, "primary");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/subscribe");
	});

	it("inactive users get a primary subscribe action only (export lives in the nav menu)", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "trial-expired" },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["subscribe"]);
		assert.equal(vm.actions[0].variant, "primary");
	});

	it("error-payment-method state exposes no actions (support email lives in the body copy)", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled" },
			{ ...baseQuery, errorPaymentMethod: true },
			now,
		);
		assert.deepEqual(vm.actions, []);
	});
});

describe("parseAccountQuery", () => {
	it("returns defaults for undefined query", () => {
		const result = parseAccountQuery(undefined);
		assert.deepEqual(result, {
			cancelling: false,
			errorPaymentMethod: false,
		});
	});
});
