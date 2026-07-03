import { generateToken } from "./generate-token";

describe("generateToken", () => {
	it("returns a 64-character hex string", () => {
		const token = generateToken();

		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("produces valid hex tokens on successive calls", () => {
		const first = generateToken();
		const second = generateToken();

		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(second).toMatch(/^[0-9a-f]{64}$/);
	});
});
