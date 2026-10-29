import assert from "node:assert/strict";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryBrowserHandoff } from "@packages/test-fixtures/providers/browser-handoff";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { useTestServer } from "../../test-app";
import { saveAccessTokenForClient } from "../test-helpers/oauth-token";

const useApp = useTestServer();

function sessionCookie(response: request.Response): string | undefined {
	const setCookie = response.headers["set-cookie"];
	const cookies = Array.isArray(setCookie) ? setCookie : [];
	return cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
}

function sessionIdOf(response: request.Response): string {
	const cookie = sessionCookie(response);
	assert(cookie, "expected the hutch_sid session cookie");
	return cookie.slice(`${SESSION_COOKIE_NAME}=`.length).split(";")[0];
}

async function appUser(harness: ReturnType<typeof useApp>, email: string) {
	const created = await harness.auth.createUser({ email, password: "password123" });
	assert(created.ok, "user must be created");
	const accessToken = await saveAccessTokenForClient(harness, { userId: created.userId, clientId: "ios-app" });
	return { userId: created.userId, accessToken };
}

async function mintCode(harness: ReturnType<typeof useApp>, accessToken: string): Promise<string> {
	const response = await request(harness.server).post("/auth/handoff").set("Authorization", `Bearer ${accessToken}`);
	assert.equal(response.status, 200);
	assert.equal(typeof response.body.code, "string");
	return response.body.code;
}

function createMutableClock(startMs: number) {
	let nowMs = startMs;
	return {
		now: () => new Date(nowMs),
		advanceSeconds: (seconds: number) => {
			nowMs += seconds * 1000;
		},
	};
}

describe("Browser handoff", () => {
	describe("POST /auth/handoff", () => {
		it("mints an uncacheable single-use code for the app's bearer", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "mint@example.com");

			const response = await request(harness.server).post("/auth/handoff").set("Authorization", `Bearer ${accessToken}`);

			assert.equal(response.status, 200);
			assert.equal(response.headers["cache-control"], "no-store");
			assert.match(response.body.code, /^[A-Za-z0-9_-]{43}$/);
			assert.equal(sessionCookie(response), undefined);
		});

		it("returns 401 when no Authorization header is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/auth/handoff");

			assert.equal(response.status, 401);
			assert.equal(response.headers["www-authenticate"], "Bearer");
		});

		it("returns 401 for an invalid bearer token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/auth/handoff").set("Authorization", "Bearer not-a-real-token");

			assert.equal(response.status, 401);
			assert.equal(response.headers["www-authenticate"], 'Bearer error="invalid_token"');
		});
	});

	describe("GET /auth/handoff", () => {
		it("signs the browser in and redirects to the return path", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "redeem@example.com");
			const code = await mintCode(harness, accessToken);
			const agent = request.agent(harness.server);

			const response = await agent.get("/auth/handoff").query({ code, return: "/export" });

			assert.equal(response.status, 303);
			assert.equal(response.headers.location, "/export");
			const cookie = sessionCookie(response);
			assert(cookie, "expected the hutch_sid session cookie");
			assert.match(cookie, /HttpOnly/);
			assert.match(cookie, /Max-Age=/);
			assert.equal(response.headers["clear-site-data"], '"storage"');
			assert.equal((await agent.get("/queue").set("Accept", "text/html")).status, 200);
		});

		it("forbids every cache from keeping the redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "nocache@example.com");
			const code = await mintCode(harness, accessToken);

			const response = await request(harness.server).get("/auth/handoff").query({ code, return: "/export" });

			assert.equal(response.headers["cache-control"], "no-store");
			assert.equal(response.headers.pragma, "no-cache");
			assert.equal(response.headers.expires, "0");
		});

		it("defaults the redirect to the queue when no return path is given", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "noreturn@example.com");
			const code = await mintCode(harness, accessToken);

			const response = await request(harness.server).get("/auth/handoff").query({ code });

			assert.equal(response.headers.location, "/queue");
			assert(sessionCookie(response), "expected the hutch_sid session cookie");
		});

		it.each([
			["an absolute URL", "https://evil.example/phish"],
			["a protocol-relative URL", "//evil.example/phish"],
		])("refuses %s as the return path", async (_label, returnUrl) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "openredirect@example.com");
			const code = await mintCode(harness, accessToken);

			const response = await request(harness.server).get("/auth/handoff").query({ code, return: returnUrl });

			assert.equal(response.headers.location, "/queue");
		});

		it("mints a session bound to no OAuth grant", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "grantless@example.com");
			const code = await mintCode(harness, accessToken);

			const response = await request(harness.server).get("/auth/handoff").query({ code, return: "/export" });

			assert.equal(await harness.auth.findSessionOAuthGrant(sessionIdOf(response)), undefined);
		});

		it("renews the browser's own session when it already belongs to the same user", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "same@example.com");
			const agent = request.agent(harness.server);
			const login = await agent.post("/login").type("form").send({ email: "same@example.com", password: "password123" });
			const browserSessionId = sessionIdOf(login);
			const code = await mintCode(harness, accessToken);

			const response = await agent.get("/auth/handoff").query({ code, return: "/export" });

			assert.equal(response.status, 303);
			assert.equal(response.headers.location, "/export");
			assert.equal(sessionIdOf(response), browserSessionId);
			assert.equal(response.headers["clear-site-data"], undefined);
		});

		it("starts a new session when the browser's session has expired server-side", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.auth.renewSession = async () => "session-gone";
			const harness = useApp(fixture);
			const { accessToken } = await appUser(harness, "stale@example.com");
			const agent = request.agent(harness.server);
			const login = await agent.post("/login").type("form").send({ email: "stale@example.com", password: "password123" });
			const browserSessionId = sessionIdOf(login);
			const code = await mintCode(harness, accessToken);

			const response = await agent.get("/auth/handoff").query({ code, return: "/export" });

			assert.notEqual(sessionIdOf(response), browserSessionId);
			assert.equal(response.headers["clear-site-data"], '"storage"');
		});

		it("replaces a different user's browser session with the app user's", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "app-user@example.com");
			await harness.auth.createUser({ email: "other@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			const login = await agent.post("/login").type("form").send({ email: "other@example.com", password: "password123" });
			const otherSessionId = sessionIdOf(login);
			const code = await mintCode(harness, accessToken);

			const response = await agent.get("/auth/handoff").query({ code, return: "/export" });

			assert.notEqual(sessionIdOf(response), otherSessionId);
			assert.equal(response.headers["clear-site-data"], '"storage"');
			assert.equal(response.headers.location, "/export");
		});

		it("rejects a replayed code and leaves the browser untouched", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { accessToken } = await appUser(harness, "replay@example.com");
			const code = await mintCode(harness, accessToken);
			await request(harness.server).get("/auth/handoff").query({ code, return: "/export" });

			const replay = await request(harness.server).get("/auth/handoff").query({ code, return: "/export" });

			assert.equal(replay.status, 303);
			assert.equal(replay.headers.location, "/export");
			assert.equal(sessionCookie(replay), undefined);
			assert.equal(replay.headers["clear-site-data"], undefined);
		});

		it("rejects an expired code", async () => {
			const clock = createMutableClock(1_700_000_000_000);
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.browserHandoff = initInMemoryBrowserHandoff({ now: clock.now });
			const harness = useApp(fixture);
			const { accessToken } = await appUser(harness, "expired@example.com");
			const code = await mintCode(harness, accessToken);
			clock.advanceSeconds(61);

			const response = await request(harness.server).get("/auth/handoff").query({ code, return: "/export" });

			assert.equal(response.headers.location, "/export");
			assert.equal(sessionCookie(response), undefined);
		});

		it("does not sign a different user's browser out when the code is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({ email: "keep@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "keep@example.com", password: "password123" });

			const response = await agent.get("/auth/handoff").query({ code: "unknown-code", return: "/export" });

			assert.equal(sessionCookie(response), undefined);
			assert.equal(response.headers["clear-site-data"], undefined);
			assert.equal((await agent.get("/queue").set("Accept", "text/html")).status, 200);
		});

		it("redirects without a session when the code is missing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/auth/handoff").query({ return: "/export" });

			assert.equal(response.status, 303);
			assert.equal(response.headers.location, "/export");
			assert.equal(sessionCookie(response), undefined);
		});
	});
});
