import assert from "node:assert/strict";
import { DISMISS_COOKIE_NAME, SAVE_COOKIE_NAME } from "@packages/onboarding-extension-signal";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";

const useApp = useTestServer();

const HTTPS_APP_ORIGIN = "https://readplace.test";
const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function signedInOn(appOrigin: string) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp({ ...fixture, shared: { ...fixture.shared, appOrigin } });
	const created = await harness.auth.createUser({ email: "test@example.com", password: "password123" });
	assert(created.ok, "test user must be created");
	const sessionId = await harness.auth.createSession({ userId: created.userId, emailVerified: true });
	return { server: harness.server, sessionCookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

function setCookieAttributeNames(response: request.Response, cookieName: string): string[] {
	const header = response.headers["set-cookie"];
	assert(Array.isArray(header), "set-cookie header must be present");
	const cookie = header.find((entry: string) => entry.startsWith(`${cookieName}=`));
	assert(cookie, `${cookieName} must be set`);
	return cookie
		.split("; ")
		.slice(1)
		.map((attribute: string) => attribute.split("=")[0]);
}

async function dismissOnboarding(appOrigin: string): Promise<request.Response> {
	const { server, sessionCookie } = await signedInOn(appOrigin);
	return request(server)
		.post("/queue/dismiss-onboarding?utm_source=onboarding&utm_medium=internal&utm_content=dismiss-no-client")
		.set("Cookie", sessionCookie)
		.set("User-Agent", CHROME_UA);
}

describe("readlist cookies follow the app origin's scheme", () => {
	it("sets the onboarding dismiss cookie without Secure on an http origin", async () => {
		const response = await dismissOnboarding(TEST_APP_ORIGIN);

		expect(response.status).toBe(303);
		expect(setCookieAttributeNames(response, DISMISS_COOKIE_NAME)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "SameSite"]);
	});

	it("sets the onboarding dismiss cookie with Secure on an https origin", async () => {
		const response = await dismissOnboarding(HTTPS_APP_ORIGIN);

		expect(response.status).toBe(303);
		expect(setCookieAttributeNames(response, DISMISS_COOKIE_NAME)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "Secure", "SameSite"]);
	});
});

async function extensionTokenOn(appOrigin: string) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp({ ...fixture, shared: { ...fixture.shared, appOrigin } });
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "the firefox extension client must exist");
	const token = await harness.oauthModel.saveToken(
		{
			accessToken: "extension-access-token",
			accessTokenExpiresAt: new Date(Date.now() + 3600000),
			refreshToken: "extension-refresh-token",
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
			client,
			user: { id: "extension-user" },
		},
		client,
		{ id: "extension-user" },
	);
	assert(token, "the extension token must be saved");
	return { server: harness.server, authorization: `Bearer ${token.accessToken}` };
}

async function saveOneArticle(appOrigin: string): Promise<request.Response> {
	const { server, authorization } = await extensionTokenOn(appOrigin);
	return request(server)
		.post("/queue")
		.set("Authorization", authorization)
		.set("Accept", SIREN_MEDIA_TYPE)
		.send({ url: "https://example.com/extension-saved-article" });
}

async function saveAllTabs(appOrigin: string): Promise<request.Response> {
	const { server, authorization } = await extensionTokenOn(appOrigin);
	return request(server)
		.post("/queue/save-articles")
		.set("Authorization", authorization)
		.set("Accept", SIREN_MEDIA_TYPE)
		.field("manifest", JSON.stringify([{ url: "https://example.com/extension-saved-tab" }]));
}

describe("the extension-saved cookie follows the app origin's scheme", () => {
	it("is set without Secure on an http origin when one article is saved", async () => {
		const response = await saveOneArticle(TEST_APP_ORIGIN);

		expect(response.status).toBe(201);
		expect(setCookieAttributeNames(response, SAVE_COOKIE_NAME)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "SameSite"]);
	});

	it("is set with Secure on an https origin when one article is saved", async () => {
		const response = await saveOneArticle(HTTPS_APP_ORIGIN);

		expect(response.status).toBe(201);
		expect(setCookieAttributeNames(response, SAVE_COOKIE_NAME)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "Secure", "SameSite"]);
	});

	it("is set without Secure on an http origin when a tab batch saves a page", async () => {
		const response = await saveAllTabs(TEST_APP_ORIGIN);

		expect(response.body.properties).toMatchObject({ saved: 1, failed: 0 });
		expect(setCookieAttributeNames(response, SAVE_COOKIE_NAME)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "SameSite"]);
	});

	it("is set with Secure on an https origin when a tab batch saves a page", async () => {
		const response = await saveAllTabs(HTTPS_APP_ORIGIN);

		expect(response.body.properties).toMatchObject({ saved: 1, failed: 0 });
		expect(setCookieAttributeNames(response, SAVE_COOKIE_NAME)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "Secure", "SameSite"]);
	});
});
