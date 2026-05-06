import request from "supertest";
import { createTestApp } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

describe("GET /privacy", () => {
	const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

	it("should return 200 and HTML content", async () => {
		const response = await request(app).get("/privacy");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});
});
