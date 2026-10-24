import { describeSignInDevice } from "./sign-in-device";

describe("describeSignInDevice", () => {
	it("describes nothing when the request carries no User-Agent", () => {
		expect(describeSignInDevice(undefined)).toBe(undefined);
	});

	it("describes nothing when neither the browser nor the operating system is known", () => {
		expect(describeSignInDevice("Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe(undefined);
	});

	it("names the browser and the operating system it signed in from", () => {
		expect(
			describeSignInDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
		).toEqual({ browser: "chrome", os: "macos" });
	});

	it("keeps the operating system when the browser is not one it knows", () => {
		expect(describeSignInDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Trident/7.0; rv:11.0")).toEqual({ browser: "other", os: "windows" });
	});

	it("records an e-reader's operating system as other", () => {
		expect(describeSignInDevice("Mozilla/5.0 (Linux; U; Android 2.0; en-us;) AppleWebKit/538.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/538.1 (Kobo Touch 0373/4.38.21908)")).toEqual({ browser: "safari", os: "other" });
	});
});
