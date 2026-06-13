/**
 * Exposes Readplace's key actions to AI browser agents through the WebMCP API
 * (`navigator.modelContext`). Registered on every page load so an agent
 * inspecting the page discovers what it can do here instead of scraping the
 * DOM.
 *
 * The proposal exposes two registration surfaces: the declarative
 * `provideContext({ tools })` from the WebMCP explainer and the imperative
 * `registerTool(tool)` shipped in Chrome's early-preview build. We feature
 * detect and prefer `provideContext`, falling back to `registerTool`, so the
 * same tools surface regardless of which the host implements. Browsers without
 * WebMCP leave `navigator.modelContext` undefined and we no-op.
 *
 * Browser globals (fetch, navigation) are injected so the module stays pure and
 * unit-testable; the wiring lives in build-client-bundles.js.
 */

export interface WebMcpToolResult {
	content: ReadonlyArray<{ type: "text"; text: string }>;
}

interface WebMcpInputSchema {
	type: "object";
	properties: Record<
		string,
		{ type: string; description: string; enum?: readonly string[] }
	>;
	required?: readonly string[];
	additionalProperties: boolean;
}

export interface WebMcpTool {
	name: string;
	description: string;
	inputSchema: WebMcpInputSchema;
	execute: (input: unknown) => Promise<WebMcpToolResult>;
}

export interface WebMcpModelContext {
	provideContext?: (context: { tools: readonly WebMcpTool[] }) => void;
	registerTool?: (tool: WebMcpTool) => void;
}

/** Only the status code is read from the save response, so the dependency stays
 * trivial to fake in tests without constructing a whole `Response`. */
export interface WebMcpResponse {
	status: number;
}

export type WebMcpFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string },
) => Promise<WebMcpResponse>;

export interface WebMcpDeps {
	modelContext: WebMcpModelContext | undefined;
	fetchFn: WebMcpFetch;
	navigate: (url: string) => void;
}

export type WebMcpProvideVia = "provideContext" | "registerTool" | "none";

/** The Siren API content type the queue save endpoint negotiates on. */
const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

function toolText(text: string): WebMcpToolResult {
	return { content: [{ type: "text", text }] };
}

function readStringField(input: unknown, key: string): string | undefined {
	if (typeof input !== "object") return undefined;
	if (input === null) return undefined;
	const value: unknown = Reflect.get(input, key);
	return typeof value === "string" ? value : undefined;
}

function saveArticle(deps: WebMcpDeps, url: string): Promise<WebMcpToolResult> {
	return deps
		.fetchFn("/queue", {
			method: "POST",
			headers: { "content-type": "application/json", accept: SIREN_MEDIA_TYPE },
			body: JSON.stringify({ url }),
		})
		.then((response) => {
			switch (response.status) {
				case 201:
					return toolText(`Saved to your Readplace reading queue: ${url}`);
				case 401:
				case 403:
					return toolText(
						"Sign in to Readplace first, then ask again to save this article.",
					);
				case 402:
					return toolText(
						"This Readplace subscription is inactive. Reactivate it to save new articles.",
					);
				case 422:
					return toolText(`That URL can't be saved to Readplace: ${url}`);
				default:
					return toolText(
						`Couldn't save the article to Readplace (HTTP ${response.status}).`,
					);
			}
		});
}

export function buildReadplaceTools(deps: WebMcpDeps): WebMcpTool[] {
	return [
		{
			name: "save_article",
			description:
				"Save an article, blog post, newsletter, or web page to the user's Readplace reading queue so they can read it later in a clean reader view. Pass the full http(s) URL of the page to save.",
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description:
							"The full http(s) URL of the article or web page to save.",
					},
				},
				required: ["url"],
				additionalProperties: false,
			},
			execute: (input) => {
				const url = readStringField(input, "url");
				if (!url) {
					return Promise.resolve(
						toolText(
							"Provide the full http(s) URL of the article you want to save.",
						),
					);
				}
				return saveArticle(deps, url);
			},
		},
		{
			name: "open_reading_queue",
			description:
				"Open the user's Readplace reading queue. Optionally choose whether to show unread articles still to read, or articles already marked as read.",
			inputSchema: {
				type: "object",
				properties: {
					filter: {
						type: "string",
						description:
							"Which articles to show: 'unread' for the to-read list (default), or 'read' for articles already finished.",
						enum: ["unread", "read"],
					},
				},
				additionalProperties: false,
			},
			execute: (input) => {
				const filter = readStringField(input, "filter");
				if (filter === "read") {
					deps.navigate("/queue?tab=done");
					return Promise.resolve(
						toolText("Opening the articles you've already read in Readplace."),
					);
				}
				deps.navigate("/queue");
				return Promise.resolve(toolText("Opening your Readplace reading queue."));
			},
		},
	];
}

export function provideWebMcpTools(deps: WebMcpDeps): WebMcpProvideVia {
	const tools = buildReadplaceTools(deps);
	const modelContext = deps.modelContext;
	if (!modelContext) return "none";
	if (typeof modelContext.provideContext === "function") {
		modelContext.provideContext({ tools });
		return "provideContext";
	}
	if (typeof modelContext.registerTool === "function") {
		for (const tool of tools) {
			modelContext.registerTool(tool);
		}
		return "registerTool";
	}
	return "none";
}
