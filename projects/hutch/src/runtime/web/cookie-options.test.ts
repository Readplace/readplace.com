import { baseCookieOptions, isHttpsOrigin } from "./cookie-options";

describe("baseCookieOptions", () => {
	it("marks cookies Secure for HTTPS deployments while keeping httpOnly, sameSite and path unchanged", () => {
		expect(baseCookieOptions(true)).toEqual({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			secure: true,
		});
	});

	it("omits Secure for plain-http local dev so browsers still accept the cookie", () => {
		expect(baseCookieOptions(false)).toEqual({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			secure: false,
		});
	});
});

describe("isHttpsOrigin", () => {
	it("returns true for an https deployment origin", () => {
		expect(isHttpsOrigin("https://readplace.com")).toBe(true);
	});

	it("returns false for a local http dev origin", () => {
		expect(isHttpsOrigin("http://localhost:3000")).toBe(false);
	});
});
