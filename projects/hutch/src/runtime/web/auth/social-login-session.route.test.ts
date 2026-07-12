import assert from "node:assert/strict";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { AppleIdSchema } from "@packages/test-fixtures/providers/apple-auth";
import { GoogleIdSchema } from "@packages/test-fixtures/providers/google-auth";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@packages/web-session";
import { useTestServer } from "../../test-app";
import type { TestAppHarness } from "../../test-app";

type TestAppFixture = ReturnType<typeof createDefaultTestAppFixture>;

/** The shape of every authorize hop the iOS app opens: its own `/oauth/authorize`
 * carrying the native custom-scheme redirect and a PKCE challenge (the sign-up
 * variant differs only in `screen_hint`). Every social sign-in reached from the
 * app is a detour off this URL. */
const IOS_AUTHORIZE_RETURN =
	"/oauth/authorize?client_id=ios-app&redirect_uri=readplace%3A%2F%2Foauth-callback" +
	"&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" +
	"&code_challenge_method=S256&state=ios-state-abc&screen_hint=login";

const OAUTH_STATE_TTL_SECONDS = 5 * 60;

function cookiesFrom(response: request.Response): string[] {
	const raw = response.headers["set-cookie"];
	return Array.isArray(raw) ? raw : [];
}

function setCookieNamed(response: request.Response, name: string): string | undefined {
	return cookiesFrom(response).find((c) => c.startsWith(`${name}=`));
}

function cookieValue({ header, name }: { header: string; name: string }): string {
	return decodeURIComponent(header.slice(name.length + 1).split(";")[0]);
}

interface SocialLoginProvider {
	readonly name: string;
	readonly stateCookieName: string;
	readonly withProvider: (fixture: TestAppFixture) => TestAppFixture;
	readonly signIn: (deps: {
		harness: TestAppHarness;
		returnUrl: string;
	}) => Promise<request.Response>;
}

const startSignIn = (deps: {
	harness: TestAppHarness;
	provider: string;
	returnUrl: string;
}): Promise<request.Response> =>
	request(deps.harness.server).get(`/auth/${deps.provider}`).query({ return: deps.returnUrl });

const stateFrom = (deps: { start: request.Response; cookieName: string }): string => {
	const header = setCookieNamed(deps.start, deps.cookieName);
	assert(header, `the sign-in start route must set the ${deps.cookieName} cookie`);
	return cookieValue({ header, name: deps.cookieName });
};

const GOOGLE_STATE_COOKIE = "hutch_gstate";
const APPLE_STATE_COOKIE = "hutch_astate";

const googleLogin: SocialLoginProvider = {
	name: "google",
	stateCookieName: GOOGLE_STATE_COOKIE,
	withProvider: (fixture) => ({
		...fixture,
		google: {
			exchangeGoogleCode: async () => ({
				googleId: GoogleIdSchema.parse("google-sub-123"),
				email: "google@example.com",
				emailVerified: true,
			}),
			clientId: "test-google-client-id",
			clientSecret: "test-google-client-secret",
		},
	}),
	signIn: async ({ harness, returnUrl }) => {
		const start = await startSignIn({ harness, provider: "google", returnUrl });
		expect(start.status).toBe(303);
		const state = stateFrom({ start, cookieName: GOOGLE_STATE_COOKIE });

		return request(harness.server)
			.get("/auth/google/callback")
			.query({ code: "test-code", state })
			.set("Cookie", `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(state)}`);
	},
};

const appleLogin: SocialLoginProvider = {
	name: "apple",
	stateCookieName: APPLE_STATE_COOKIE,
	withProvider: (fixture) => ({
		...fixture,
		apple: {
			exchangeAppleCode: async () => ({
				appleId: AppleIdSchema.parse("apple-sub-123"),
				email: "apple@example.com",
				emailVerified: true,
				appleRefreshToken: "apple-refresh-123",
			}),
			clientId: "test-apple-client-id",
			stateSigningSecret: "test-apple-state-secret",
		},
	}),
	/* Apple answers with response_mode=form_post. */
	signIn: async ({ harness, returnUrl }) => {
		const start = await startSignIn({ harness, provider: "apple", returnUrl });
		expect(start.status).toBe(303);
		const state = stateFrom({ start, cookieName: APPLE_STATE_COOKIE });

		return request(harness.server)
			.post("/auth/apple/callback")
			.type("form")
			.set("Cookie", `${APPLE_STATE_COOKIE}=${encodeURIComponent(state)}`)
			.send({ code: "test-code", state });
	},
};

const SOCIAL_LOGIN_PROVIDERS: readonly SocialLoginProvider[] = [googleLogin, appleLogin];

const useApp = useTestServer();

describe.each(SOCIAL_LOGIN_PROVIDERS)(
	"$name sign-in, reached from the iOS app's authorize hop",
	(provider) => {
		it("mints a session cookie that survives the browser fully closing", async () => {
			const harness = useApp(provider.withProvider(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

			const callback = await provider.signIn({ harness, returnUrl: IOS_AUTHORIZE_RETURN });

			expect(callback.status).toBe(303);
			const cookie = setCookieNamed(callback, SESSION_COOKIE_NAME);
			assert(cookie, `the ${provider.name} callback must set ${SESSION_COOKIE_NAME}`);
			expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS};`);
		});

		it("expires the sign-in state cookie in minutes, not for the session's lifetime", async () => {
			const harness = useApp(provider.withProvider(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

			const start = await startSignIn({
				harness,
				provider: provider.name,
				returnUrl: IOS_AUTHORIZE_RETURN,
			});

			const cookie = setCookieNamed(start, provider.stateCookieName);
			assert(cookie, `GET /auth/${provider.name} must set ${provider.stateCookieName}`);
			expect(cookie).toContain(`Max-Age=${OAUTH_STATE_TTL_SECONDS};`);
		});

		it("returns the browser to the authorize hop with the PKCE challenge intact", async () => {
			const harness = useApp(provider.withProvider(createDefaultTestAppFixture(TEST_APP_ORIGIN)));

			const callback = await provider.signIn({ harness, returnUrl: IOS_AUTHORIZE_RETURN });

			expect(callback.status).toBe(303);
			expect(callback.headers.location).toBe(IOS_AUTHORIZE_RETURN);
		});
	},
);
