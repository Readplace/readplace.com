import request from "supertest";
import type { RenewSession } from "@packages/provider-contracts/auth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import type { TestAppFixture } from "@packages/web-test-harness";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@packages/web-session";
import { useTestServer } from "../../test-app";

const useApp = useTestServer();

function clockedAuth(clock: { now: Date }) {
	const auth = initInMemoryAuth({
		hashPassword: async (password) => `plain:${password}`,
		verifyPassword: async (password, stored) => stored === `plain:${password}`,
		now: () => clock.now,
	});
	return { ...auth, hashPassword: async (password: string) => `plain:${password}` };
}

function fixtureWithClock(
	clock: { now: Date },
	overrideRenew?: (base: RenewSession) => RenewSession,
): TestAppFixture {
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const auth = clockedAuth(clock);
	const renewSession = overrideRenew ? overrideRenew(auth.renewSession) : auth.renewSession;
	return {
		...base,
		shared: { ...base.shared, now: () => clock.now },
		auth: { ...auth, renewSession },
	};
}

function sessionCookie(response: request.Response): string | undefined {
	const setCookie = response.headers["set-cookie"];
	const cookies = Array.isArray(setCookie) ? setCookie : [];
	return cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
}

async function loginAndGetCookie(
	harness: ReturnType<typeof useApp>,
	email: string,
): Promise<string> {
	await harness.auth.createUser({ email, password: "password123" });
	const response = await request(harness.server)
		.post("/login")
		.type("form")
		.send({ email, password: "password123" });
	const cookie = sessionCookie(response);
	if (!cookie) throw new Error("login did not set a session cookie");
	return cookie.split(";")[0];
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("slide-session middleware", () => {
	it("renews the row and re-sends the cookie once a day has passed since the last stamp", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		const harness = useApp(fixtureWithClock(clock));
		const cookie = await loginAndGetCookie(harness, "active@example.com");

		clock.now = new Date(clock.now.getTime() + 25 * 60 * 60 * 1000);
		const response = await request(harness.server).get("/privacy").set("Cookie", cookie);

		expect(response.status).toBe(200);
		expect(sessionCookie(response)).toContain(`Max-Age=${SESSION_TTL_SECONDS};`);
	});

	it("does not write or re-send a cookie within a day of the last stamp", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		let renewCalls = 0;
		const harness = useApp(
			fixtureWithClock(clock, (base) => async (session) => {
				renewCalls += 1;
				return base(session);
			}),
		);
		const cookie = await loginAndGetCookie(harness, "quiet@example.com");

		clock.now = new Date(clock.now.getTime() + 23 * 60 * 60 * 1000);
		const response = await request(harness.server).get("/privacy").set("Cookie", cookie);

		expect(response.status).toBe(200);
		expect(sessionCookie(response)).toBeUndefined();
		expect(renewCalls).toBe(0);
	});

	it("keeps an active reader signed in past 180 days from login, because the window slides", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		const harness = useApp(fixtureWithClock(clock));
		const cookie = await loginAndGetCookie(harness, "daily@example.com");

		clock.now = new Date(clock.now.getTime() + 100 * DAY_MS);
		const atHundred = await request(harness.server).get("/privacy").set("Cookie", cookie);
		expect(sessionCookie(atHundred)).toContain(`Max-Age=${SESSION_TTL_SECONDS};`);

		clock.now = new Date(clock.now.getTime() + 100 * DAY_MS);
		expect(await harness.auth.getSessionUserId(cookie.split("=")[1])).not.toBeNull();
	});

	it("signs out a reader idle past the window", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		const harness = useApp(fixtureWithClock(clock));
		const cookie = await loginAndGetCookie(harness, "idle@example.com");
		const sessionId = cookie.split("=")[1];

		clock.now = new Date(clock.now.getTime() + 179 * DAY_MS);
		expect(await harness.auth.getSessionUserId(sessionId)).not.toBeNull();

		clock.now = new Date(clock.now.getTime() + 2 * DAY_MS);
		expect(await harness.auth.getSessionUserId(sessionId)).toBeNull();
	});

	it("renders the page signed in when the renewal write fails", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		const harness = useApp(
			fixtureWithClock(clock, () => async () => {
				throw new Error("dynamo unavailable");
			}),
		);
		const cookie = await loginAndGetCookie(harness, "blip@example.com");

		clock.now = new Date(clock.now.getTime() + 25 * 60 * 60 * 1000);
		const response = await request(harness.server).get("/privacy").set("Cookie", cookie);

		expect(response.status).toBe(200);
		expect(sessionCookie(response)).toBeUndefined();
	});

	it("re-sends no cookie and leaves no session when a logout races the renewal", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		const fixture = fixtureWithClock(clock, (base) => async (session) => {
			await fixture.auth.destroySession(session.sessionId);
			return base(session);
		});
		const harness = useApp(fixture);
		const cookie = await loginAndGetCookie(harness, "racer@example.com");

		clock.now = new Date(clock.now.getTime() + 25 * 60 * 60 * 1000);
		const response = await request(harness.server).get("/privacy").set("Cookie", cookie);

		expect(sessionCookie(response)).toBeUndefined();
		expect(await harness.auth.getSessionUserId(cookie.split("=")[1])).toBeNull();
	});

	it("does not renew for a guest with no session cookie", async () => {
		const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
		let renewCalls = 0;
		const harness = useApp(
			fixtureWithClock(clock, (base) => async (session) => {
				renewCalls += 1;
				return base(session);
			}),
		);

		const response = await request(harness.server).get("/privacy");

		expect(response.status).toBe(200);
		expect(renewCalls).toBe(0);
	});
});
