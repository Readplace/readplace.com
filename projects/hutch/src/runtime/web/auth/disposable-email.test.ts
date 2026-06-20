import { isDisposableEmailDomain } from "./disposable-email";

/** Seeded in disposable-email-domains.custom.txt — the fixed known-blocked domain. */
const KNOWN_DISPOSABLE_DOMAIN = "slmail.me";

describe("isDisposableEmailDomain", () => {
	it("matches an exact root domain", () => {
		expect(isDisposableEmailDomain(`user@${KNOWN_DISPOSABLE_DOMAIN}`)).toBe(true);
	});

	it("matches a subdomain by walking up to the blocked root", () => {
		expect(isDisposableEmailDomain(`user@kss.${KNOWN_DISPOSABLE_DOMAIN}`)).toBe(true);
	});

	it("matches case-insensitively", () => {
		expect(isDisposableEmailDomain("user@SLMAIL.ME")).toBe(true);
	});

	it("returns false for a legitimate single-level domain", () => {
		expect(isDisposableEmailDomain("user@gmail.com")).toBe(false);
	});

	it("returns false for a legitimate multi-label domain", () => {
		expect(isDisposableEmailDomain("user@mail.company.co.uk")).toBe(false);
	});
});
