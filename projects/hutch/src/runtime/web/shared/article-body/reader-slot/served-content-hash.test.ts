import { servedContentHash } from "./served-content-hash";

describe("servedContentHash", () => {
	it("is the hex SHA-256 of the served normalised text", () => {
		expect(servedContentHash("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("changes when the served text changes", () => {
		expect(servedContentHash("abc")).not.toBe(servedContentHash("abd"));
	});
});
