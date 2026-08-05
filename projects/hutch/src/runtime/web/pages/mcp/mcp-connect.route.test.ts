import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

const CONNECT_PROMPT = "Connect my reading list to readplace.com/mcp.";
const SAVE_PROMPT = "Save this research to my readplace.";

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

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
		["empty Accept", ""],
	])("serves the guide to a fetching agent that sends %s", async (_label, accept) => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", accept);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(response.text).toContain("https://readplace.com/mcp");
	});

	it("serves the guide when no Accept header is sent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(response.text).toContain("https://readplace.com/mcp");
	});

	it("returns the guide as markdown when Accept: text/markdown is sent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).toMatch(/^# Connect Readplace to your AI assistant \(MCP\)/);
		expect(response.text).toContain("https://readplace.com/mcp");
		expect(response.text).toContain(SAVE_PROMPT);
		expect(response.text).not.toContain("<script");
	});

	it.each([
		["text/event-stream", "text/event-stream"],
		["application/json, text/event-stream", "application/json, text/event-stream"],
	])("falls through to the transport 405 when Accept includes %s", async (_label, accept) => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", accept);

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

	it("pairs the one-time connect prompt with the sentence that saves from then on", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", "text/html");
		const doc = load(response.text);

		const prompts = Array.from(
			doc.querySelectorAll('[data-test-section="getting-started"] .mcp-connect__example-text'),
		).map((node) => node.textContent);

		expect(prompts).toEqual([CONNECT_PROMPT, SAVE_PROMPT]);
	});

	it("tells an assistant that is not listed on the page how to connect anyway", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", "text/html");

		expect(response.text).toContain("even one not listed on this page");
		expect(response.text).toContain(
			"add the Readplace server URL as a custom connector",
		);
	});

	it("offers a copy button for the server URL and every prompt", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", "text/html");
		const doc = load(response.text);

		const copyTargets = Array.from(doc.querySelectorAll("[data-mcp-copy]")).map((button) => {
			assert(button.hasAttribute("hidden"), "copy button stays hidden until the script reveals it");
			return button.getAttribute("data-mcp-text");
		});

		expect(copyTargets).toContain("https://readplace.com/mcp");
		expect(copyTargets).toContain(CONNECT_PROMPT);
		expect(copyTargets).toContain(SAVE_PROMPT);
		expect(response.text).toContain("/client-dist/mcp.client.js");
	});

	it("targets the rendered copy buttons with the selectors its built bundle wires", async () => {
		const bundleSource = readFileSync(
			join(__dirname, "..", "..", "client-dist", "mcp.client.js"),
			"utf-8",
		);
		const copySelector = bundleSource.match(/copySelector:\s*'([^']+)'/)?.[1];
		const textAttr = bundleSource.match(/textAttr:\s*'([^']+)'/)?.[1];
		assert(copySelector, "the mcp bundle footer must wire a copySelector");
		assert(textAttr, "the mcp bundle footer must wire a textAttr");

		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/mcp").set("Accept", "text/html");
		const doc = load(response.text);

		const targeted = Array.from(doc.querySelectorAll(copySelector));
		expect(targeted.length).toBeGreaterThan(0);
		for (const button of targeted) {
			assert(button.hasAttribute(textAttr), `copy button must carry ${textAttr}`);
		}
	});
});
