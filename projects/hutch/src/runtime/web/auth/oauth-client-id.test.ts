import { oauthClientIdFrom } from "./oauth-client-id";

describe("oauthClientIdFrom", () => {
	it("returns the client id for a built-in client's consent return URL", () => {
		expect(
			oauthClientIdFrom("/oauth/authorize?client_id=ios-app&redirect_uri=readplace%3A%2F%2Foauth-callback&response_type=code"),
		).toBe("ios-app");
	});

	it("returns the opaque base64url id a dynamically registered connector is issued", () => {
		expect(
			oauthClientIdFrom("/oauth/authorize?client_id=ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm&response_type=code"),
		).toBe("ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm");
	});

	it("reads only client_id from a consent return URL that also carries state and code_challenge", () => {
		const returnUrl =
			"/oauth/authorize?client_id=ios-app&redirect_uri=readplace%3A%2F%2Foauth-callback&response_type=code" +
			"&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=abc123";

		expect(oauthClientIdFrom(returnUrl)).toBe("ios-app");
	});

	it("returns undefined when there is no return URL", () => {
		expect(oauthClientIdFrom(undefined)).toBeUndefined();
	});

	it("returns undefined for a return URL that is not the consent screen", () => {
		expect(oauthClientIdFrom("/queue?client_id=ios-app")).toBeUndefined();
	});

	it("returns undefined when the consent return URL carries no client_id", () => {
		expect(oauthClientIdFrom("/oauth/authorize?response_type=code")).toBeUndefined();
	});

	it("returns undefined for a client id this server could never have issued", () => {
		expect(oauthClientIdFrom("/oauth/authorize?client_id=ios%20app%3Cscript%3E")).toBeUndefined();
	});

	it("returns undefined for a client id longer than any this server mints", () => {
		expect(oauthClientIdFrom(`/oauth/authorize?client_id=${"a".repeat(65)}`)).toBeUndefined();
	});

	it("returns undefined instead of throwing when the return URL itself is unparseable (backslash forces an invalid authority)", () => {
		expect(oauthClientIdFrom("/\\[")).toBeUndefined();
	});
});
