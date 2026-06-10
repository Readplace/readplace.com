import assert from "node:assert/strict";
import request from "supertest";
import { useTestServer } from "../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME } from "./auth/session-cookie";
import { CLICK_COOKIE_NAME } from "./click-attribution.middleware";
import { VISITOR_COOKIE_NAME } from "./visitor-id.middleware";

const HTTPS_APP_ORIGIN = "https://readplace.com";

function findCookie(headers: { [key: string]: string | string[] | undefined }, name: string): string {
	const raw = headers["set-cookie"];
	const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const cookie = cookies.find((c) => c.startsWith(`${name}=`));
	assert(cookie, `expected a Set-Cookie header for ${name}`);
	return cookie;
}

const useApp = useTestServer();

async function postLogin(harness: ReturnType<typeof useApp>) {
	await harness.auth.createUser({ email: "test@example.com", password: "password123" });
	return request(harness.server)
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
}

describe("Cookie Secure attribute", () => {
	describe("HTTPS deployment origin", () => {
		it("sets the visitor-id and click-attribution cookies with Secure, HttpOnly and SameSite=Lax", async () => {
			const harness = useApp(createDefaultTestAppFixture(HTTPS_APP_ORIGIN));
			const response = await request(harness.server).get("/");

			for (const name of [VISITOR_COOKIE_NAME, CLICK_COOKIE_NAME]) {
				const cookie = findCookie(response.headers, name);
				expect(cookie).toContain("; Secure");
				expect(cookie).toContain("; HttpOnly");
				expect(cookie).toContain("; SameSite=Lax");
				expect(cookie).toContain("; Path=/");
			}
		});

		it("sets the session cookie with Secure, HttpOnly and SameSite=Lax on login", async () => {
			const harness = useApp(createDefaultTestAppFixture(HTTPS_APP_ORIGIN));
			const response = await postLogin(harness);

			expect(response.status).toBe(303);
			const cookie = findCookie(response.headers, SESSION_COOKIE_NAME);
			expect(cookie).toContain("; Secure");
			expect(cookie).toContain("; HttpOnly");
			expect(cookie).toContain("; SameSite=Lax");
			expect(cookie).toContain("; Path=/");
		});
	});

	describe("local plain-http dev origin", () => {
		it("still sets the visitor-id and click-attribution cookies, without Secure", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/");

			for (const name of [VISITOR_COOKIE_NAME, CLICK_COOKIE_NAME]) {
				const cookie = findCookie(response.headers, name);
				expect(cookie).not.toContain("; Secure");
				expect(cookie).toContain("; HttpOnly");
				expect(cookie).toContain("; SameSite=Lax");
			}
		});

		it("still sets the session cookie on login, without Secure, so local login keeps working", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await postLogin(harness);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			const cookie = findCookie(response.headers, SESSION_COOKIE_NAME);
			expect(cookie).not.toContain("; Secure");
			expect(cookie).toContain("; HttpOnly");
			expect(cookie).toContain("; SameSite=Lax");
		});
	});
});
