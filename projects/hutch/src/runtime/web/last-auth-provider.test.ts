import type { CookieOptions } from "express";
import {
	LAST_AUTH_PROVIDER_COOKIE_NAME,
	readLastAuthProvider,
	setLastAuthProvider,
} from "./last-auth-provider";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function recordingRes() {
	const written: { name: string; value: string; options: CookieOptions }[] = [];
	const res = {
		cookie: (name: string, value: string, options: CookieOptions) => {
			written.push({ name, value, options });
		},
	};
	return { res, written };
}

describe("readLastAuthProvider", () => {
	it("returns the provider a previous sign-in recorded", () => {
		expect(readLastAuthProvider({ cookies: { [LAST_AUTH_PROVIDER_COOKIE_NAME]: "apple" } })).toBe(
			"apple",
		);
	});

	it("returns undefined when the browser has never signed in", () => {
		expect(readLastAuthProvider({ cookies: {} })).toBeUndefined();
	});

	it("returns undefined when there is no cookie jar", () => {
		expect(readLastAuthProvider({})).toBeUndefined();
	});

	it("treats a value outside the known providers as absent rather than rendering it", () => {
		expect(
			readLastAuthProvider({ cookies: { [LAST_AUTH_PROVIDER_COOKIE_NAME]: "evil-provider" } }),
		).toBeUndefined();
	});
});

describe("setLastAuthProvider", () => {
	it("writes the provider so a later logged-out visit can still read it", () => {
		const { res, written } = recordingRes();

		setLastAuthProvider({ res, secure: true }, "google");

		expect(written).toEqual([
			{
				name: LAST_AUTH_PROVIDER_COOKIE_NAME,
				value: "google",
				options: {
					httpOnly: true,
					sameSite: "lax",
					path: "/",
					secure: true,
					maxAge: ONE_YEAR_MS,
				},
			},
		]);
	});

	it("omits Secure on a plain-http dev origin", () => {
		const { res, written } = recordingRes();

		setLastAuthProvider({ res, secure: false }, "apple");

		expect(written[0]?.options.secure).toBe(false);
	});
});
