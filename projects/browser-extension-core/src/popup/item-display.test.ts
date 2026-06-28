import { itemDisplay } from "./item-display";

describe("itemDisplay", () => {
	it("derives the hostname from the item url", () => {
		expect(itemDisplay({ url: "https://example.com/article" })).toEqual({
			hostname: "example.com",
		});
	});

	it("yields a blank hostname for an empty url instead of throwing", () => {
		expect(itemDisplay({ url: "" })).toEqual({
			hostname: "",
		});
	});

	it("yields a blank hostname for a malformed url instead of throwing", () => {
		expect(itemDisplay({ url: "not a url" })).toEqual({
			hostname: "",
		});
	});
});
