import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import request from "supertest";
import { createTestApp } from "./test-app";

describe("session middleware resilience", () => {
	it("degrades a request with a session cookie to guest (still 200) when the session lookup throws, instead of 500ing the page", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN), {
			getSessionUserId: async () => {
				throw new Error("sessions table unavailable");
			},
		});

		const response = await request(app)
			.get("/privacy")
			.set("Cookie", `${SESSION_COOKIE_NAME}=any-session-token`);

		expect(response.status).toBe(200);
	});
});
