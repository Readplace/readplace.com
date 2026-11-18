import assert from "node:assert/strict";
import { formatChargeAmount } from "./billing-amount";

describe("formatChargeAmount", () => {
	it("formats a two-decimal foreign currency with its own symbol", () => {
		assert.equal(formatChargeAmount({ amountMinor: 4500, currency: "eur" }), "€45.00");
	});

	it("does not invent decimals for a zero-decimal currency", () => {
		assert.equal(formatChargeAmount({ amountMinor: 5000, currency: "jpy" }), "¥5,000");
	});

	it("shows a zero amount with its decimals, as a $0 receipt reads", () => {
		assert.equal(formatChargeAmount({ amountMinor: 0, currency: "usd" }), "$0.00");
	});
});
