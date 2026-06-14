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

/** The save endpoint authenticates with the session cookie and 303-redirects to
 * a page whose URL encodes the outcome, so the followed response's final `url`
 * (and `status`) — not a status code alone — tells saved / signed-out /
 * inactive / rejected apart. Both fields come straight off a real `Response`, so
 * tests can fake the dependency without constructing one. */
export interface WebMcpResponse {
	status: number;
	url: string;
}

export type WebMcpFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string },
) => Promise<WebMcpResponse>;

export interface WebMcpDeps {
	modelContext: WebMcpModelContext | undefined;
	fetchFn: WebMcpFetch;
	navigate: (url: string) => void;
	/** Reads the page's server-rendered sign-in state (the `data-authenticated`
	 * body attribute). `open_reading_queue` needs it because navigation is
	 * fire-and-forget — without it the tool can't tell a signed-out agent that
	 * `/queue` will bounce to `/login`, so it would report "opening your queue"
	 * while the page lands on the login form. */
	isAuthenticated: () => boolean;
}

export type WebMcpProvideVia = "provideContext" | "registerTool" | "none";

/**
 * The browser save bar posts here. It authenticates with the `hutch_sid`
 * session cookie — sent by default on this same-origin POST — instead of the
 * extension's OAuth Bearer token, which page JavaScript cannot read. POSTing to
 * the Siren `POST /queue` surface would always 401 from a page, because that
 * branch demands a Bearer header and never consults the cookie.
 */
const SAVE_ENDPOINT = "/queue/save";

/** Parsing base for the followed response URL. A real `Response.url` is absolute
 * and overrides this; the base only stops `new URL` throwing on an empty value. */
const SAVE_OUTCOME_BASE = "https://readplace.com";

function toolText(text: string): WebMcpToolResult {
	return { content: [{ type: "text", text }] };
}

function readStringField(input: unknown, key: string): string | undefined {
	if (typeof input !== "object") return undefined;
	if (input === null) return undefined;
	const value: unknown = Reflect.get(input, key);
	return typeof value === "string" ? value : undefined;
}

/**
 * The save endpoint speaks redirects, not status codes: an unsaveable URL
 * re-renders the queue with 422, every other outcome 303-redirects to a page
 * whose path/query names what happened. After the browser follows the redirect,
 * the final `response.url` is what distinguishes them — `/login` (signed out),
 * `?inactive=1` (subscription lapsed), `?error_code=save_failed` (server error),
 * or a clean `/queue` (saved).
 */
function classifySaveOutcome(
	response: WebMcpResponse,
	url: string,
): WebMcpToolResult {
	if (response.status === 422) {
		return toolText(`That URL can't be saved to Readplace: ${url}`);
	}
	const outcome = new URL(response.url, SAVE_OUTCOME_BASE);
	if (outcome.pathname === "/login") {
		return toolText(
			"Sign in to Readplace first, then ask again to save this article.",
		);
	}
	if (outcome.searchParams.has("inactive")) {
		return toolText(
			"This Readplace subscription is inactive. Reactivate it to save new articles.",
		);
	}
	if (outcome.searchParams.get("error_code") === "save_failed") {
		return toolText(
			"Couldn't save the article to Readplace right now — please try again in a moment.",
		);
	}
	if (outcome.pathname === "/queue") {
		return toolText(`Saved to your Readplace reading queue: ${url}`);
	}
	return toolText(
		`Couldn't save the article to Readplace (HTTP ${response.status}).`,
	);
}

function saveArticle(deps: WebMcpDeps, url: string): Promise<WebMcpToolResult> {
	return deps
		.fetchFn(SAVE_ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: `url=${encodeURIComponent(url)}`,
		})
		.then((response) => classifySaveOutcome(response, url))
		.catch(() =>
			toolText(
				"Couldn't reach Readplace right now — check your connection and try again.",
			),
		);
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
				if (!deps.isAuthenticated()) {
					deps.navigate("/login");
					return Promise.resolve(
						toolText(
							"Sign in to Readplace first, then ask again to open your reading queue.",
						),
					);
				}
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
