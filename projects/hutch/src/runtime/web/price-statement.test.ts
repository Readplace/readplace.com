import { PRICE_STATEMENT, RENEWAL_PRICES, SAVES_STAY_STATEMENT } from "./price-statement";

describe("the price statement", () => {
	it("states the trial, then both renewal prices", () => {
		expect(PRICE_STATEMENT).toBe("14 days free, no card. Then $60 a year ($5 a month, billed yearly) or $10 a month.");
	});

	it("states the renewal prices without the trial clause, for readers whose trial has ended", () => {
		expect(RENEWAL_PRICES).toBe("$60 a year ($5 a month, billed yearly) or $10 a month.");
	});

	it("promises that saves outlast the subscription", () => {
		expect(SAVES_STAY_STATEMENT).toBe("Your saves stay readable and exportable, even if you stop paying.");
	});
});
