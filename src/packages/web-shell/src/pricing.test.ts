import { ANNUAL_PRICE_DISPLAY } from "./pricing";

describe("ANNUAL_PRICE_DISPLAY", () => {
	it("is the displayed annual price", () => {
		expect(ANNUAL_PRICE_DISPLAY).toBe("$49");
	});
});
