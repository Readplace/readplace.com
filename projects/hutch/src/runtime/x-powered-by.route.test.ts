import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "./test-app";

const useApp = useTestServer();

describe("X-Powered-By", () => {
	it("is not sent, so a response does not name the framework", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server).get("/");
		expect(response.headers["x-powered-by"]).toBeUndefined();
	});
});
