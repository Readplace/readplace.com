import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import request from "supertest";
import { useTestServer } from "./test-app";

const useApp = useTestServer({
	getSessionUserId: async () => {
		throw new Error("sessions table unavailable");
	},
});

describe("session middleware resilience", () => {
	it("degrades a request with a session cookie to guest (still 200) when the session lookup throws, instead of 500ing the page", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server)
			.get("/privacy")
			.set("Cookie", `${SESSION_COOKIE_NAME}=any-session-token`);

		expect(response.status).toBe(200);
	});
});
