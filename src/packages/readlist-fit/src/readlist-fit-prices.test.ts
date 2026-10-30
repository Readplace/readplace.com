import { READLIST_FIT_MICRO_DOLLARS_PER_LINK } from "./readlist-fit-prices";

describe("READLIST_FIT_MICRO_DOLLARS_PER_LINK", () => {
	it.each(Object.entries(READLIST_FIT_MICRO_DOLLARS_PER_LINK))("gives %s a positive cost per link", (_engine, cost) => {
		expect(cost).toBeGreaterThan(0);
	});
});
