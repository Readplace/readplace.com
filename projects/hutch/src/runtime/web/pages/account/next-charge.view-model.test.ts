import assert from "node:assert/strict";
import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import { buildNextChargeViewModel } from "./next-charge.view-model";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function chargeIn(days: number, overrides: Partial<SubscriptionNextCharge> = {}): SubscriptionNextCharge {
	return {
		at: new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
		amountMinor: 4900,
		currency: "usd",
		...overrides,
	};
}

describe("buildNextChargeViewModel", () => {
	it("renders the date and amount when the charge is inside the window", () => {
		const at = chargeIn(12).at;
		const vm = buildNextChargeViewModel({ nextCharge: chargeIn(12), now: NOW });

		assert.equal(vm.state, "visible");
		assert.equal(vm.stateClass, "account-card__next-charge account-card__next-charge--visible");
		assert.equal(vm.leadIn, "Next charge on ");
		assert.deepEqual(vm.date, { iso: at, label: "Jul 26, 2026", mode: "date" });
		assert.equal(vm.tail, " — $49.00.");
	});

	it("shows a charge due in exactly thirty days — the boundary is inclusive", () => {
		const vm = buildNextChargeViewModel({ nextCharge: chargeIn(30), now: NOW });

		assert.equal(vm.state, "visible");
	});

	it("hides a charge that is still more than thirty days out", () => {
		const vm = buildNextChargeViewModel({ nextCharge: chargeIn(31), now: NOW });

		assert.equal(vm.state, "hidden");
		assert.equal(vm.stateClass, "account-card__next-charge account-card__next-charge--hidden");
		assert.equal(vm.date, undefined);
		assert.equal(vm.tail, "");
	});

	it("hides a charge dated in the past", () => {
		const vm = buildNextChargeViewModel({ nextCharge: chargeIn(-1), now: NOW });

		assert.equal(vm.state, "hidden");
	});

	it("hides when there is no charge at all", () => {
		const vm = buildNextChargeViewModel({ nextCharge: undefined, now: NOW });

		assert.equal(vm.state, "hidden");
	});

	it("hides a charge whose date cannot be read rather than rendering a broken line", () => {
		const vm = buildNextChargeViewModel({ nextCharge: chargeIn(5, { at: "not-a-date" }), now: NOW });

		assert.equal(vm.state, "hidden");
	});

	it("does not announce a zero charge — nothing is owed", () => {
		const vm = buildNextChargeViewModel({ nextCharge: chargeIn(5, { amountMinor: 0 }), now: NOW });

		assert.equal(vm.state, "hidden");
	});

	it("quotes the amount the reader will actually pay, not a fixed list price", () => {
		const vm = buildNextChargeViewModel({
			nextCharge: chargeIn(5, { amountMinor: 2900 }),
			now: NOW,
		});

		assert.equal(vm.tail, " — $29.00.");
	});

	it("formats a two-decimal foreign currency with its own symbol", () => {
		const vm = buildNextChargeViewModel({
			nextCharge: chargeIn(5, { amountMinor: 4500, currency: "eur" }),
			now: NOW,
		});

		assert.equal(vm.tail, " — €45.00.");
	});

	it("does not invent decimals for a zero-decimal currency", () => {
		const vm = buildNextChargeViewModel({
			nextCharge: chargeIn(5, { amountMinor: 5000, currency: "jpy" }),
			now: NOW,
		});

		assert.equal(vm.tail, " — ¥5,000.");
	});
});
