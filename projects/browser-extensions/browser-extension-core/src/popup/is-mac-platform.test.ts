import { isMacPlatform } from "./is-mac-platform";

describe("isMacPlatform", () => {
	it("trusts userAgentData when the browser reports it", () => {
		expect(isMacPlatform({ platform: "Win32", userAgentData: { platform: "macOS" } })).toBe(true);
	});

	it("ignores a Mac platform string when userAgentData names another OS", () => {
		expect(isMacPlatform({ platform: "MacIntel", userAgentData: { platform: "Windows" } })).toBe(false);
	});

	it("falls back to the platform string when userAgentData is absent, as in Firefox", () => {
		expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
	});

	it("reports any other platform string as not a Mac", () => {
		expect(isMacPlatform({ platform: "Win32" })).toBe(false);
	});
});
