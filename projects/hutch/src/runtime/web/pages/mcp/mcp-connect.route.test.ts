import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /mcp (browser connection guide)", () => {
	it("serves the HTML guide to a browser (Accept: text/html)", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server)
			.get("/mcp")
			.set("Accept", "text/html,application/xhtml+xml");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(response.text).toContain("https://readplace.com/mcp");
		expect(response.text).toContain("Claude");
		expect(response.text).toContain("ChatGPT");
		expect(response.text).toContain("Gemini");
		expect(response.text).toContain("Perplexity");
		expect(response.text).toContain("get_article");
		expect(response.text).toContain("marking articles read and deleting them stay in the Readplace app");
	});

	it.each([
		["*/*", "*/*"],
		["application/json", "application/json"],
		["text/event-stream", "application/json, text/event-stream"],
	])("falls through to 405 for non-browser Accept (%s)", async (_label, accept) => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", accept);

		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe("POST");
	});

	it("falls through to 405 when no Accept header is sent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		// supertest sends a default Accept; clear it to model a bare client probe.
		const response = await request(server).get("/mcp").set("Accept", "");

		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe("POST");
	});

	it("leaves DELETE /mcp returning 405", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).delete("/mcp").set("Accept", "text/html");
		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe("POST");
	});

	it("leaves POST /mcp without a token returning the 401 auth bootstrap", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server)
			.post("/mcp")
			.set("Accept", "application/json")
			.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

		expect(response.status).toBe(401);
		expect(response.headers["www-authenticate"]).toContain(
			"oauth-protected-resource",
		);
	});
});
