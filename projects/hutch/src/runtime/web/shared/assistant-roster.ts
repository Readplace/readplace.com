import assert from "node:assert";
import { type ClientInGroup, SUPPORTED_CLIENTS } from "@packages/supported-clients";

export function findRosterAssistant(registeredName: string): ClientInGroup<"aiAssistant"> | undefined {
	return SUPPORTED_CLIENTS.find(
		(candidate): candidate is ClientInGroup<"aiAssistant"> =>
			candidate.group === "aiAssistant" &&
			candidate.displayName.toLowerCase() === registeredName.trim().toLowerCase(),
	);
}

const claude = SUPPORTED_CLIENTS.find((candidate) => candidate.name === "claude");
assert(claude, "Client missing from SUPPORTED_CLIENTS: claude");
assert(claude.install.kind === "mcpConnector", "Claude install must be the MCP connector");

export const MCP_SERVER_URL = claude.install.serverUrl;
export const MCP_GUIDE_PATH = claude.install.guidePath;
