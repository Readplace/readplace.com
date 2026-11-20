import {
	FIRST_DAYS_STATEMENT,
	FREE_PLAN_STATEMENT,
	FREE_PRICE_STATEMENT,
	PRICE_STATEMENT,
	RENEWAL_PRICES,
	SAVES_STAY_STATEMENT,
	UPGRADE_STATEMENT,
} from "./price-statement";

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

	it("states what the free plan gives, with its daily limits beside the claim", () => {
		expect(FREE_PLAN_STATEMENT).toBe(
			"Free to use, with no card: save new links within daily limits and read everything you save.",
		);
	});

	it("states that every new account starts on the paid plan", () => {
		expect(FIRST_DAYS_STATEMENT).toBe("Every new account gets the paid plan for its first 14 days.");
	});

	it("names the five paid features and both prices", () => {
		expect(UPGRADE_STATEMENT).toBe(
			"Upgrade for the Inbox, Next read, Past reads, readlist purpose filtering and Gmail, without the free plan's daily limits: $60 a year ($5 a month, billed yearly) or $10 a month.",
		);
	});

	it("leads the full offer with the free plan, then the first days, then the upgrade", () => {
		expect(FREE_PRICE_STATEMENT).toBe(
			"Free to use, with no card: save new links within daily limits and read everything you save. Every new account gets the paid plan for its first 14 days. Upgrade for the Inbox, Next read, Past reads, readlist purpose filtering and Gmail, without the free plan's daily limits: $60 a year ($5 a month, billed yearly) or $10 a month.",
		);
	});
});
