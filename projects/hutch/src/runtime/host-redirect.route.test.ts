import request from "supertest";
import { EDGE_SECRET_HEADER, VIEWER_HOST_HEADER } from "@packages/viewer-identity";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { TEST_EDGE_SECRET, useTestServer } from "./test-app";

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
		const response = await request(harness.server).get("/login");
		expect(response.status).toBe(200);
	});

	it("301s on the host the edge says the viewer asked for, not the origin the edge dialled", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server)
			.get("/queue")
			.set("Host", "abc123.execute-api.ap-southeast-2.amazonaws.com")
			.set(EDGE_SECRET_HEADER, TEST_EDGE_SECRET)
			.set(VIEWER_HOST_HEADER, "hutch-app.com");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://readplace.com/queue");
	});

	it("ignores a claimed viewer host that arrives without the edge secret", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server)
			.get("/login")
			.set(VIEWER_HOST_HEADER, "hutch-app.com");
		expect(response.status).toBe(200);
	});
});
