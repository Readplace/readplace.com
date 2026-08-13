import {
	MCP_PROTOCOL_VERSION,
	MCP_RESOURCE_METADATA_PATH,
	MCP_SERVER_INFO,
} from "./protocol";
import { TOOL_DEFINITIONS } from "./tool-definitions";

/**
 * The SEP-2127 MCP Server Card served at `/.well-known/mcp/server-card.json`.
 * It lets an agent discover the Readplace MCP endpoint, its protocol revision,
 * its tools, and how to authenticate — without first opening a session.
 *
 * Every field is sourced from the same constants the live `/mcp` server uses
 * (protocol version, server info, tool list) and points at metadata Readplace
 * already serves (the OAuth protected-resource document), so the card never
 * advertises a capability the server does not actually have.
 */
export function buildMcpServerCard(baseUrl: string): object {
	return {
		protocolVersion: MCP_PROTOCOL_VERSION,
		serverInfo: MCP_SERVER_INFO,
		description:
			"Save links to your Readplace reading queue, list what you have saved, fetch a saved article's metadata, reader view, and AI summary, and mark one read or unread. Deleting is done in the Readplace app.",
		documentationUrl: `${baseUrl}/auth.md`,
		transport: {
			type: "streamable-http",
			endpoint: `${baseUrl}/mcp`,
		},
		capabilities: {
			tools: { listChanged: false },
		},
		authentication: {
			required: true,
			schemes: ["oauth2"],
			protectedResourceMetadata: `${baseUrl}${MCP_RESOURCE_METADATA_PATH}`,
		},
		tools: TOOL_DEFINITIONS.map((tool) => ({
			name: tool.name,
			title: tool.title,
			description: tool.description,
		})),
	};
}
