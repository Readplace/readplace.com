import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { MCP_CONNECT_STYLES } from "./mcp-connect.styles";

const MCP_CONNECT_TEMPLATE = readFileSync(join(__dirname, "mcp-connect.template.html"), "utf-8");

/**
 * Durable, non-version-specific connection steps for each client family. The
 * requirements (paid tier, Developer Mode, OAuth) are the stable parts of each
 * product's setup; we deliberately avoid menu-label minutiae that rots.
 */
const MCP_TOOLS = [
	{
		name: "Claude",
		requirement:
			"Works on Free, Pro, Max, Team, and Enterprise. The Free plan allows a single custom connector.",
		steps: [
			"Open Settings and go to Connectors.",
			"Choose “Add custom connector”.",
			"Paste the Readplace server URL and save.",
			"Open the connector and complete the one-time OAuth sign-in to authorize Claude.",
		],
	},
	{
		name: "ChatGPT",
		requirement:
			"Needs a paid plan (Plus, Pro, Business, Enterprise, or Edu). Custom connectors live behind Developer Mode, which you turn on from ChatGPT on the web.",
		steps: [
			"On ChatGPT for web, open Settings → Apps & Connectors → Advanced and turn on Developer Mode.",
			"Add a custom connector and enter the Readplace server URL.",
			"Choose OAuth as the authentication method.",
			"Complete the OAuth sign-in to authorize ChatGPT.",
		],
	},
	{
		name: "Perplexity",
		requirement: "Needs a Pro, Max, or Enterprise plan.",
		steps: [
			"On Perplexity for web, open Settings → Connectors.",
			"Choose “+ Custom connector”, then “Remote”.",
			"Enter the Readplace server URL and select OAuth.",
			"Authorize Readplace when you are redirected to the sign-in screen.",
		],
	},
	{
		name: "Claude Code, Cursor, VS Code, and other MCP clients",
		requirement:
			"No paid plan required. Point the client at the URL over the HTTP (Streamable HTTP) transport — it discovers the OAuth login and registers itself automatically.",
		steps: [
			"Claude Code: run “claude mcp add --transport http readplace https://readplace.com/mcp”, then “/mcp” to sign in.",
			"Cursor or VS Code: add a server with the Readplace URL and transport type “http” to your MCP config; the editor runs the OAuth flow.",
			"Any MCP client: add a remote HTTP server at the Readplace URL and authorize when prompted.",
		],
	},
] as const;

const GETTING_STARTED_PROMPT = "Connect my reading list to readplace.com/mcp.";

const EXAMPLE_PROMPTS = [
	"Save the top sources from your research to my Readplace.",
	"What's the most relevant unread link in my Readplace about the war in Iran?",
	"Save this page to my reading queue.",
	"List everything I've saved but haven't read yet.",
] as const;

export function McpConnectPage(): PageBody {
	return {
		seo: {
			title: "Connect Readplace to your AI assistant (MCP) — Readplace",
			description:
				"Readplace runs an MCP server. Connect Claude, ChatGPT, Perplexity, or any MCP client and your assistant can save pages to your reading queue and list back what you have saved.",
			canonicalUrl: "https://readplace.com/mcp",
			robots: "index, follow",
		},
		styles: MCP_CONNECT_STYLES,
		bodyClass: "page-mcp-connect",
		content: {
			html: render(MCP_CONNECT_TEMPLATE, {
				serverUrl: "https://readplace.com/mcp",
				gettingStartedPrompt: GETTING_STARTED_PROMPT,
				tools: MCP_TOOLS,
				examples: EXAMPLE_PROMPTS,
			}),
		},
	};
}
