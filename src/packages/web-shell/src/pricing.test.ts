import {
	ANNUAL_PRICE_AMOUNT,
	ANNUAL_PRICE_DISPLAY,
	MONTHLY_EQUIVALENT_AMOUNT,
	MONTHLY_EQUIVALENT_DISPLAY,
	SUBSCRIBE_CTA_LABEL,
} from "./pricing";

describe("ANNUAL_PRICE_DISPLAY", () => {
	it("is the amount actually charged to the card, once a year", () => {
		expect(ANNUAL_PRICE_DISPLAY).toBe("$49");
	});
});

describe("MONTHLY_EQUIVALENT_DISPLAY", () => {
	it("is the annual price divided by twelve, to the cent", () => {
		expect(MONTHLY_EQUIVALENT_DISPLAY).toBe("$4.08");
	});

	it("does not overstate the annual price when multiplied back out", () => {
		const monthly = Number(MONTHLY_EQUIVALENT_DISPLAY.replace("$", ""));
		expect(monthly * 12).toBeLessThanOrEqual(49);
	});
});

describe("SUBSCRIBE_CTA_LABEL", () => {
	it("quotes the monthly equivalent, not the annual charge", () => {
		expect(SUBSCRIBE_CTA_LABEL).toBe("Subscribe — $4.08/month");
	});
});

describe("the symbol-free amounts", () => {
	it("carry the same numbers as the displayed prices, so a surface that sets the currency itself cannot quote a different one", () => {
		expect(ANNUAL_PRICE_AMOUNT).toBe("49");
		expect(MONTHLY_EQUIVALENT_AMOUNT).toBe("4.08");
		expect(ANNUAL_PRICE_DISPLAY).toBe(`$${ANNUAL_PRICE_AMOUNT}`);
		expect(MONTHLY_EQUIVALENT_DISPLAY).toBe(`$${MONTHLY_EQUIVALENT_AMOUNT}`);
	});
});
