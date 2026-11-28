import { createContentSignalMiddleware } from "@packages/web-session";
import { MCP_RESOURCE_METADATA_PATH } from "./mcp/protocol";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=no";

const NON_PAGE_PREFIXES = [
	"/robots.txt",
	"/llms.txt",
	"/llms-full.txt",
	"/auth.md",
	"/sitemap.xml",
	"/slogans",
	"/health",
	"/.well-known/api-catalog",
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-protected-resource",
	MCP_RESOURCE_METADATA_PATH,
];

const AGENT_SKILLS_NAMESPACE = "/.well-known/agent-skills/";

function isNonPage(path: string): boolean {
	return NON_PAGE_PREFIXES.some(p => path === p) || path.startsWith(AGENT_SKILLS_NAMESPACE);
}

export const contentSignalMiddleware = createContentSignalMiddleware({ value: CONTENT_SIGNAL_VALUE, isNonPage });
