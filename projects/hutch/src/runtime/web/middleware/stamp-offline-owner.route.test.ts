import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@packages/web-session";
import { useTestServer } from "../../test-app";

const useApp = useTestServer();

async function login(harness: ReturnType<typeof useApp>, email: string): Promise<{ cookie: string; sessionId: string }> {
	await harness.auth.createUser({ email, password: "password123" });
	const response = await request(harness.server).post("/login").type("form").send({ email, password: "password123" });
	const setCookie = response.headers["set-cookie"];
	const cookies = Array.isArray(setCookie) ? setCookie : [];
	const session = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
	assert(session, "login must set a session cookie");
	const cookie = session.split(";")[0];
	return { cookie, sessionId: cookie.slice(SESSION_COOKIE_NAME.length + 1) };
}

function offlineHeaders(response: request.Response): Record<string, string> {
	return Object.fromEntries(
		Object.entries(response.headers).filter(([name]) => name.startsWith("readplace-offline-owner")),
	);
}

describe("stampOfflineOwner", () => {
	it("names the session a readlist page answered for, by a one-way hash of its id, and when that session expires", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const before = Math.floor(Date.now() / 1000);
		const { cookie, sessionId } = await login(harness, "owner@example.com");

		const response = await request(harness.server).get("/queue").set("Cookie", cookie);

		expect(response.status).toBe(200);
		const headers = offlineHeaders(response);
		expect(headers["readplace-offline-owner"]).toBe(createHash("sha256").update(sessionId).digest("hex"));
		const expiresAt = Number(headers["readplace-offline-owner-expires"]);
		expect(expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL_SECONDS);
		expect(expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
	});

	it("names no session on a readlist answer to a visitor who is signed out", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/queue");

		expect(response.status).toBe(303);
		expect(offlineHeaders(response)).toEqual({});
	});
});
