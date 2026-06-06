import { initInMemoryFetchInboundEmail } from "./in-memory-fetch-inbound-email";

describe("initInMemoryFetchInboundEmail", () => {
	it("returns a seeded body and undefined for an unknown id", async () => {
		const { fetchInboundEmail, seedInboundEmail } = initInMemoryFetchInboundEmail();
		seedInboundEmail("email-1", { html: "<p>Hello</p>" });

		expect(await fetchInboundEmail("email-1")).toEqual({ html: "<p>Hello</p>" });
		expect(await fetchInboundEmail("missing")).toBeUndefined();
	});
});
