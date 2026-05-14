import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /privacy", () => {
	it("should return 200 and HTML content", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("returns markdown when Accept: text/markdown is sent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server)
			.get("/privacy")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).toMatch(/^# /);
	});
});
