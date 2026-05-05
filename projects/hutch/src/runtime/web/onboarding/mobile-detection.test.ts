import { isMobileUserAgent } from "./mobile-detection";

describe("isMobileUserAgent", () => {
	it("detects iPhone Safari as mobile", () => {
		const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
		expect(isMobileUserAgent(ua)).toBe(true);
	});

	it("detects Chrome on Android as mobile", () => {
		const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
		expect(isMobileUserAgent(ua)).toBe(true);
	});

	it("detects Firefox iOS (FxiOS) as mobile", () => {
		const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15";
		expect(isMobileUserAgent(ua)).toBe(true);
	});

	it("detects Chrome iOS (CriOS) as mobile", () => {
		const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1";
		expect(isMobileUserAgent(ua)).toBe(true);
	});

	it("treats desktop Chrome as non-mobile", () => {
		const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
		expect(isMobileUserAgent(ua)).toBe(false);
	});

	it("treats desktop Firefox as non-mobile", () => {
		const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
		expect(isMobileUserAgent(ua)).toBe(false);
	});

	it("treats empty user agent as non-mobile", () => {
		expect(isMobileUserAgent("")).toBe(false);
	});
});
