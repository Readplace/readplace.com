import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "./test-app";

const useApp = useTestServer();

describe("hutch-app.com → readplace.com host redirect", () => {
	it("301s the root path, preserving the query string", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server)
			.get("/?ref=newsletter")
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://readplace.com/?ref=newsletter");
	});

	it("301s a deep app path, preserving path and multi-param query", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server)
			.get("/queue?tag=x&page=2")
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(
			"https://readplace.com/queue?tag=x&page=2",
		);
	});

	it("301s blog paths via the global redirect, not a blog-specific handler", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server)
			.get("/blog/some-post")
			.set("Host", "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(
			"https://readplace.com/blog/some-post",
		);
	});

	it("does not redirect requests whose Host is not hutch-app.com", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server).get("/blog");
		expect(response.status).toBe(200);
	});
});
