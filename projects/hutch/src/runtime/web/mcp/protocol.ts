/**
 * The MCP protocol revision this server speaks, echoed in the `initialize`
 * result and advertised on the discovery card. Pinned to a known revision
 * rather than "latest" so a client that negotiates against it gets a stable
 * contract.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Identifies the Readplace MCP server software (distinct from
 * MCP_PROTOCOL_VERSION, which versions the wire protocol). Shared by the
 * `initialize` handshake and the published server card so the two never drift.
 */
export const MCP_SERVER_INFO = {
	name: "Readplace",
	title: "Readplace",
	version: "1.0.0",
} as const;
