import { OAuthSignInSchema, laterSignIn, oauthSignIn } from "./sign-in";

describe("oauthSignIn", () => {
	it("records the time, where and what the reader approved from", () => {
		const signIn = oauthSignIn({
			at: 1_760_000_000_000,
			location: { city: "Sydney", country: "AU" },
			device: { browser: "chrome", os: "macos" },
		});

		expect(signIn).toEqual({ at: 1_760_000_000_000, location: { city: "Sydney", country: "AU" }, device: { browser: "chrome", os: "macos" } });
		expect(OAuthSignInSchema.parse(signIn)).toEqual(signIn);
	});

	it("leaves out the location and device it was not given, so the stored row carries no undefined key", () => {
		const signIn = oauthSignIn({ at: 1_760_000_000_000, location: undefined, device: undefined });

		expect(Object.keys(signIn)).toEqual(["at"]);
		expect(OAuthSignInSchema.parse(signIn)).toEqual({ at: 1_760_000_000_000 });
	});

	it.each([
		{ location: { city: "Sydney", country: undefined }, keys: ["city"] },
		{ location: { city: undefined, country: "AU" }, keys: ["country"] },
	])("keeps only the location parts it knows: $keys", ({ location, keys }) => {
		const signIn = oauthSignIn({ at: 1, location, device: undefined });

		expect(signIn.location && Object.keys(signIn.location)).toEqual(keys);
	});
});

describe("laterSignIn", () => {
	const earlier = oauthSignIn({ at: 1_000, location: undefined, device: { browser: "safari", os: "ios" } });
	const later = oauthSignIn({ at: 2_000, location: undefined, device: { browser: "chrome", os: "windows" } });

	it("has no sign-in when neither side has one", () => {
		expect(laterSignIn(undefined, undefined)).toBe(undefined);
	});

	it("keeps the one side that has a sign-in", () => {
		expect([laterSignIn(earlier, undefined), laterSignIn(undefined, earlier)]).toEqual([earlier, earlier]);
	});

	it("keeps the later sign-in whichever side it is on", () => {
		expect([laterSignIn(earlier, later), laterSignIn(later, earlier)]).toEqual([later, later]);
	});

	it("keeps the first of two sign-ins at the same moment", () => {
		const sameMoment = oauthSignIn({ at: 1_000, location: { country: "AU" }, device: undefined });

		expect(laterSignIn(earlier, sameMoment)).toBe(earlier);
	});
});
