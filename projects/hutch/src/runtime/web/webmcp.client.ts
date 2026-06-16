/**
 * WebMCP exposes Readplace's primary action — saving a link to the reading
 * queue — to an in-browser AI agent. The agent reads the page, finds the tool,
 * and can save on the user's behalf.
 *
 * The proposal is still split across two API surfaces: Chrome's preview ships
 * `navigator.modelContext.provideContext({ tools })`, while the W3C draft uses
 * `registerTool(tool)`. We feature-detect both so the tool shows up whichever
 * one the runtime implements. The module stays free of browser globals (the
 * context object and navigation are injected) so it unit-tests without a DOM.
 */
interface WebMcpTextContent {
	type: "text";
	text: string;
}

interface WebMcpToolResult {
	content: WebMcpTextContent[];
	isError?: boolean;
}

interface WebMcpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: unknown) => Promise<WebMcpToolResult>;
}

export interface ModelContextLike {
	provideContext?: (context: { tools: WebMcpTool[] }) => unknown;
	registerTool?: (tool: WebMcpTool) => unknown;
}

interface WebMcpDeps {
	modelContext: ModelContextLike | null | undefined;
	navigateTo: (url: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.toString();
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function buildReadplaceTools(
	navigateTo: (url: string) => void,
): WebMcpTool[] {
	return [
		{
			name: "save_link",
			description:
				"Save a web page (article, blog post, or PDF) to the user's Readplace reading queue to read later.",
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "The absolute http(s) URL of the page to save.",
					},
				},
				required: ["url"],
				additionalProperties: false,
			},
			execute: async (input) => {
				const url = isRecord(input) ? parseHttpUrl(input.url) : undefined;
				if (!url) {
					return {
						content: [
							{
								type: "text",
								text: "Provide an absolute http(s) URL to save.",
							},
						],
						isError: true,
					};
				}
				navigateTo(`/save?url=${encodeURIComponent(url)}`);
				return {
					content: [
						{ type: "text", text: `Saving ${url} to your Readplace queue.` },
					],
				};
			},
		},
	];
}

/** Register Readplace's tools with whichever WebMCP surface the browser
 * exposes. Returns whether a tool surface was found and used. */
export function initWebMcp(deps: WebMcpDeps): boolean {
	const context = deps.modelContext;
	if (!context) return false;

	const tools = buildReadplaceTools(deps.navigateTo);

	if (typeof context.provideContext === "function") {
		context.provideContext({ tools });
		return true;
	}
	if (typeof context.registerTool === "function") {
		for (const tool of tools) {
			context.registerTool(tool);
		}
		return true;
	}
	return false;
}
