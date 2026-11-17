import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../test-app";

const useApp = useTestServer();

describe("Content-Security-Policy on the pages a scanner reported without one", () => {
	it.each([
		["/", {}],
		["/ai-reading-list", {}],
		["/install", {}],
		["/mcp", { Accept: "text/html" }],
		["/queue", {}],
	])("limits framing, plugin elements and base URLs on %s and leaves script and style sources open", async (path, headers) => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));
		const response = await request(harness.server).get(path).set(headers);
		expect(response.headers["content-security-policy"]).toBe(
			"frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
		);
	});
});
