import { isValidTotpCode, totpCodeAt } from "./totp";

const rfc6238Secret = Buffer.from("12345678901234567890", "ascii");

describe("totpCodeAt", () => {
	it.each([
		[59, "287082"],
		[1111111109, "081804"],
		[1111111111, "050471"],
		[1234567890, "005924"],
		[2000000000, "279037"],
		[20000000000, "353130"],
	])("gives the RFC 6238 Appendix B SHA-1 code at %i seconds", (seconds, code) => {
		expect(totpCodeAt({ secret: rfc6238Secret, atMs: seconds * 1000 })).toBe(code);
	});
});

describe("isValidTotpCode", () => {
	const atMs = 1111111111 * 1000;
	const stepMs = 30_000;

	it("accepts the code of the current step", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs });

		expect(isValidTotpCode({ secret: rfc6238Secret, code, atMs })).toBe(true);
	});

	it("accepts the code of the previous step", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs - stepMs });

		expect(isValidTotpCode({ secret: rfc6238Secret, code, atMs })).toBe(true);
	});

	it("accepts the code of the next step", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs + stepMs });

		expect(isValidTotpCode({ secret: rfc6238Secret, code, atMs })).toBe(true);
	});

	it("refuses the code of a step two steps behind", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs - 2 * stepMs });

		expect(isValidTotpCode({ secret: rfc6238Secret, code, atMs })).toBe(false);
	});

	it("refuses the code of a step two steps ahead", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs + 2 * stepMs });

		expect(isValidTotpCode({ secret: rfc6238Secret, code, atMs })).toBe(false);
	});

	it("refuses a code of the wrong length", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs });

		expect(isValidTotpCode({ secret: rfc6238Secret, code: `${code}0`, atMs })).toBe(false);
	});
});
