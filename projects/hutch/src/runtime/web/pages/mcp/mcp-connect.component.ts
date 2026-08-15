import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import type { ClientNameInGroup } from "@packages/supported-clients";
import { mcpOperationsWithEffect } from "@packages/domain/mcp";

import { MCP_CONNECT_STYLES } from "./mcp-connect.styles";

const MCP_CONNECT_TEMPLATE = readFileSync(join(__dirname, "mcp-connect.template.html"), "utf-8");

type McpTool = {
	readonly name: string;
	readonly requirement: string;
	readonly steps: readonly string[];
};

/**
 * Durable, non-version-specific connection steps for each client family; we
 * deliberately avoid menu-label minutiae that rots.
 */
const MCP_SETUP = {
	chatgpt: {
		requirement:
			"Readplace is an official ChatGPT plugin, so there is no custom connector to configure and no Developer Mode to turn on.",
		steps: [
			"Open the Readplace plugin in ChatGPT and choose Add.",
			"Complete the OAuth sign-in to authorize ChatGPT.",
			"Ask ChatGPT to save a link, or to list what you have saved.",
		],
	},
	gemini: {
		requirement:
			"No paid plan required — the Gemini CLI connects for free. The Gemini app only takes custom connectors inside Gemini Spark, which needs a Google AI Ultra subscription.",
		steps: [
			"Install the Gemini CLI and sign in with your Google account.",
			"Run “gemini mcp add --transport http --scope user readplace https://readplace.com/mcp”.",
			"Start Gemini and run “/mcp auth readplace”. The CLI discovers the OAuth login and registers itself, so there is no client ID or secret to configure.",
			"Complete the browser sign-in to authorize Gemini, then run “/mcp list” to confirm Readplace is connected.",
		],
	},
	claude: {
		requirement:
			"Works on Free, Pro, Max, Team, and Enterprise. The Free plan allows a single custom connector.",
		steps: [
			"Open Settings and go to Connectors.",
			"Choose “Add custom connector”.",
			"Paste the Readplace server URL and save.",
			"Open the connector and complete the one-time OAuth sign-in to authorize Claude.",
		],
	},
} satisfies Record<ClientNameInGroup<"aiAssistant">, Omit<McpTool, "name">>;

const PERPLEXITY_CARD: McpTool = {
	name: "Perplexity",
	requirement: "Needs a Pro, Max, or Enterprise plan.",
	steps: [
		"On Perplexity for web, open Settings → Connectors.",
		"Choose “+ Custom connector”, then “Remote”.",
		"Enter the Readplace server URL and select OAuth.",
		"Authorize Readplace when you are redirected to the sign-in screen.",
	],
};

const OTHER_CLIENTS_CARD: McpTool = {
	name: "Claude Code, Cursor, VS Code, and other MCP clients",
	requirement:
		"No paid plan required. Point the client at the URL over the HTTP (Streamable HTTP) transport — it discovers the OAuth login and registers itself automatically. The same recipe covers any assistant that takes custom MCP connectors, even one not listed on this page.",
	steps: [
		"Claude Code: run “claude mcp add --transport http readplace https://readplace.com/mcp”, then “/mcp” to sign in.",
		"Cursor or VS Code: add a server with the Readplace URL and transport type “http” to your MCP config; the editor runs the OAuth flow.",
		"Any other assistant: open its connector or MCP settings, add the Readplace server URL as a custom connector, and complete the OAuth sign-in in your browser.",
		"Then say “Save this research to my readplace.” — the assistant maps it onto the tools for you.",
	],
};

const MCP_TOOLS: readonly McpTool[] = [
	...SUPPORTED_CLIENTS.flatMap((client) =>
		client.group === "aiAssistant" ? [{ name: client.displayName, ...MCP_SETUP[client.name] }] : [],
	),
	PERPLEXITY_CARD,
	OTHER_CLIENTS_CARD,
];

const claude = SUPPORTED_CLIENTS.find((client) => client.name === "claude");
assert(claude, "Claude missing from SUPPORTED_CLIENTS");
assert(claude.install.kind === "mcpConnector", "Claude install must be the MCP connector");
const MCP_SERVER_URL = claude.install.serverUrl;

const GETTING_STARTED_PROMPT = "Connect my reading list to readplace.com/mcp.";

export const SAVE_INTENT_PROMPT = "Save this research to my readplace.";

const GETTING_STARTED = [
	{ label: "Ask your assistant once", prompt: GETTING_STARTED_PROMPT },
	{ label: "Then, in any conversation", prompt: SAVE_INTENT_PROMPT },
] as const;

const EXAMPLE_PROMPTS = [
	"Save the top sources from your research to my readplace.",
	"What's the most relevant unread link in my readplace about the war in Iran?",
	"Save this page to my reading queue.",
	"List everything I've saved but haven't read yet.",
	"Mark the article I just finished as read.",
] as const;

const ASSISTANT_CAPABILITIES = [
	...mcpOperationsWithEffect("save"),
	...mcpOperationsWithEffect("read"),
	...mcpOperationsWithEffect("update"),
];

const APP_ONLY_OPERATIONS = mcpOperationsWithEffect("appOnly");

const ORIGIN = "https://readplace.com";
const CANONICAL_URL = `${ORIGIN}/mcp`;

const MCP_CONNECT_TITLE = "Connect Readplace to your AI assistant";

const MCP_CONNECT_DESCRIPTION =
	"Readplace runs an MCP server. Connect ChatGPT, Gemini, Claude, Perplexity, or any MCP client and your assistant can save pages to your reading queue and list back what you have saved.";

const MCP_COPY_SCRIPT = `<script src="/client-dist/mcp.client.js" defer></script>`;

export function McpConnectPage(): PageBody {
	return {
		seo: {
			title: `${MCP_CONNECT_TITLE} (MCP) — Readplace`,
			description: MCP_CONNECT_DESCRIPTION,
			canonicalUrl: CANONICAL_URL,
			robots: "index, follow",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebPage",
					"@id": CANONICAL_URL,
					name: MCP_CONNECT_TITLE,
					url: CANONICAL_URL,
					description: MCP_CONNECT_DESCRIPTION,
					isPartOf: { "@type": "WebSite", name: "Readplace", url: ORIGIN },
					about: { "@id": `${ORIGIN}/#app` },
				},
				...MCP_TOOLS.map((tool) => ({
					"@context": "https://schema.org",
					"@type": "HowTo",
					name: `Connect Readplace to ${tool.name}`,
					description: tool.requirement,
					step: tool.steps.map((text, index) => ({
						"@type": "HowToStep",
						position: index + 1,
						text,
					})),
				})),
				{
					"@context": "https://schema.org",
					"@type": "BreadcrumbList",
					itemListElement: [
						{ "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
						{ "@type": "ListItem", position: 2, name: "Connect your AI assistant", item: CANONICAL_URL },
					],
				},
			],
		},
		styles: MCP_CONNECT_STYLES,
		bodyClass: "page-mcp-connect",
		content: {
			html: render(MCP_CONNECT_TEMPLATE, {
				serverUrl: MCP_SERVER_URL,
				gettingStarted: GETTING_STARTED,
				tools: MCP_TOOLS,
				examples: EXAMPLE_PROMPTS,
				capabilities: ASSISTANT_CAPABILITIES,
				appOnlyOperations: APP_ONLY_OPERATIONS,
			}),
		},
		scripts: MCP_COPY_SCRIPT,
	};
}
