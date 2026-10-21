import { z } from "zod";

export const SignInBrowserSchema = z.enum(["chrome", "safari", "firefox", "edge", "samsung_internet", "opera", "other"]);
export type SignInBrowser = z.infer<typeof SignInBrowserSchema>;

export const SignInOsSchema = z.enum(["windows", "macos", "ios", "android", "chromeos", "linux", "other"]);
export type SignInOs = z.infer<typeof SignInOsSchema>;

export const OAuthSignInSchema = z.object({
	at: z.number(),
	location: z.object({ city: z.string().optional(), country: z.string().optional() }).optional(),
	device: z.object({ browser: SignInBrowserSchema, os: SignInOsSchema }).optional(),
});
export type OAuthSignIn = z.infer<typeof OAuthSignInSchema>;
export type OAuthSignInLocation = NonNullable<OAuthSignIn["location"]>;
export type OAuthSignInDevice = NonNullable<OAuthSignIn["device"]>;

function signInLocation(location: OAuthSignInLocation): OAuthSignInLocation {
	return {
		...(location.city === undefined ? {} : { city: location.city }),
		...(location.country === undefined ? {} : { country: location.country }),
	};
}

export function oauthSignIn(input: {
	at: number;
	location: OAuthSignInLocation | undefined;
	device: OAuthSignInDevice | undefined;
}): OAuthSignIn {
	return {
		at: input.at,
		...(input.location === undefined ? {} : { location: signInLocation(input.location) }),
		...(input.device === undefined ? {} : { device: { browser: input.device.browser, os: input.device.os } }),
	};
}

export function laterSignIn(a: OAuthSignIn | undefined, b: OAuthSignIn | undefined): OAuthSignIn | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return b.at > a.at ? b : a;
}
