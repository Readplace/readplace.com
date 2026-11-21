import { matchedTotpStep, totpCodeAt } from "./totp";

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

describe("matchedTotpStep", () => {
	const atMs = 1111111111 * 1000;
	const stepMs = 30_000;
	const currentStep = Math.floor(1111111111 / 30);

	it("returns the current step for its code", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs });

		expect(matchedTotpStep({ secret: rfc6238Secret, code, atMs })).toBe(currentStep);
	});

	it("returns the previous step for its code", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs - stepMs });

		expect(matchedTotpStep({ secret: rfc6238Secret, code, atMs })).toBe(currentStep - 1);
	});

	it("returns the next step for its code", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs + stepMs });

		expect(matchedTotpStep({ secret: rfc6238Secret, code, atMs })).toBe(currentStep + 1);
	});

	it("refuses the code of a step two steps behind", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs - 2 * stepMs });

		expect(matchedTotpStep({ secret: rfc6238Secret, code, atMs })).toBe(undefined);
	});

	it("refuses the code of a step two steps ahead", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs: atMs + 2 * stepMs });

		expect(matchedTotpStep({ secret: rfc6238Secret, code, atMs })).toBe(undefined);
	});

	it("refuses a code of the wrong length", () => {
		const code = totpCodeAt({ secret: rfc6238Secret, atMs });

		expect(matchedTotpStep({ secret: rfc6238Secret, code: `${code}0`, atMs })).toBe(undefined);
	});
});
