import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../test-app";

const useApp = useTestServer();

describe("client-dist htmx bundle", () => {
	it("serves htmx as htmx's own classic script, whose top-level var is the only thing that makes window.htmx exist", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/htmx.client.js");

		expect(response.status).toBe(200);
		expect(response.text.startsWith("var htmx=(function(")).toBe(true);
	});

	it("points at a source map", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/htmx.client.js");

		expect(response.text).toContain("//# sourceMappingURL=htmx.client.js.map");
	});

	it("serves the source map it points at, so the devtools fetch is a 200 rather than an errors-table row", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/htmx.client.js.map");

		expect(response.status).toBe(200);
		expect(response.body.version).toBe(3);
	});
});
