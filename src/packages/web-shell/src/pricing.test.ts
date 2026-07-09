import { ANNUAL_PRICE_DISPLAY, SUBSCRIBE_CTA_LABEL } from "./pricing";

describe("ANNUAL_PRICE_DISPLAY", () => {
	it("is the displayed annual price", () => {
		expect(ANNUAL_PRICE_DISPLAY).toBe("$49");
	});
});

describe("SUBSCRIBE_CTA_LABEL", () => {
	it("composes the subscribe CTA label from the annual price", () => {
		expect(SUBSCRIBE_CTA_LABEL).toBe("Subscribe — $49/year");
	});
});
