import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { buildMcpServerCard } from "./server-card";
import { TOOL_DEFINITIONS } from "./tool-definitions";

describe("buildMcpServerCard", () => {
	const card = buildMcpServerCard("https://readplace.com");

	it("advertises the streamable-http /mcp endpoint under the given origin", () => {
		expect(card).toMatchObject({
			transport: { type: "streamable-http", endpoint: "https://readplace.com/mcp" },
		});
	});

	it("reports protocol version, server info, and tool capability matching the live server", () => {
		expect(card).toMatchObject({
			protocolVersion: MCP_PROTOCOL_VERSION,
			serverInfo: MCP_SERVER_INFO,
			capabilities: { tools: { listChanged: false } },
		});
	});

	it("points authentication at the existing OAuth protected-resource metadata", () => {
		expect(card).toMatchObject({
			authentication: {
				required: true,
				schemes: ["oauth2"],
				protectedResourceMetadata:
					"https://readplace.com/.well-known/oauth-protected-resource",
			},
		});
	});

	it("summarises exactly the tools the server implements", () => {
		expect(card).toMatchObject({
			tools: TOOL_DEFINITIONS.map((tool) => ({
				name: tool.name,
				description: tool.description,
			})),
		});
	});

	it("derives documentation and endpoint URLs from the provided base url", () => {
		expect(buildMcpServerCard("https://example.test")).toMatchObject({
			documentationUrl: "https://example.test/auth.md",
			transport: { endpoint: "https://example.test/mcp" },
		});
	});
});
