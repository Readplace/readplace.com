import {
	buildReadplaceTools,
	provideWebMcpTools,
	type WebMcpDeps,
	type WebMcpFetch,
	type WebMcpModelContext,
	type WebMcpResponse,
	type WebMcpTool,
} from "./webmcp.client";

/** A saved article 303-redirects to `/queue#latest-saved`; the browser follows
 * it as a GET and drops the fragment from `response.url` (per the Fetch spec),
 * so the final URL the tool classifies is a bare `/queue`. The route test pins
 * the server's `303 + Location`; this pins the client's reading of the result. */
const SAVED_RESPONSE: WebMcpResponse = {
	status: 200,
	url: "https://readplace.com/queue",
};

function fetchReturning(response: WebMcpResponse): {
	fetchFn: WebMcpFetch;
	calls: Array<{ url: string; init: Parameters<WebMcpFetch>[1] }>;
} {
	const calls: Array<{ url: string; init: Parameters<WebMcpFetch>[1] }> = [];
	const fetchFn: WebMcpFetch = (url, init) => {
		calls.push({ url, init });
		return Promise.resolve(response);
	};
	return { fetchFn, calls };
}

function makeDeps(overrides: Partial<WebMcpDeps> = {}): {
	deps: WebMcpDeps;
	navigations: string[];
} {
	const navigations: string[] = [];
	const deps: WebMcpDeps = {
		modelContext: undefined,
		fetchFn: () => Promise.resolve(SAVED_RESPONSE),
		navigate: (url) => navigations.push(url),
		isAuthenticated: () => true,
		...overrides,
	};
	return { deps, navigations };
}

function toolByName(tools: WebMcpTool[], name: string): WebMcpTool {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool ${name} not registered`);
	return tool;
}

describe("buildReadplaceTools", () => {
	it("registers a save_article tool with a url string input schema", () => {
		const { deps } = makeDeps();
		const save = toolByName(buildReadplaceTools(deps), "save_article");

		expect(save.description.length).toBeGreaterThan(0);
		expect(save.inputSchema.type).toBe("object");
		expect(save.inputSchema.properties.url.type).toBe("string");
		expect(save.inputSchema.required).toEqual(["url"]);
		expect(save.inputSchema.additionalProperties).toBe(false);
	});

	it("registers an open_reading_queue tool with an unread/read filter enum", () => {
		const { deps } = makeDeps();
		const open = toolByName(buildReadplaceTools(deps), "open_reading_queue");

		expect(open.description.length).toBeGreaterThan(0);
		expect(open.inputSchema.properties.filter.enum).toEqual(["unread", "read"]);
		expect(open.inputSchema.required).toBeUndefined();
	});
});

describe("save_article execute", () => {
	function runSave(input: unknown, response: WebMcpResponse) {
		const { fetchFn, calls } = fetchReturning(response);
		const { deps } = makeDeps({ fetchFn });
		const save = toolByName(buildReadplaceTools(deps), "save_article");
		return { result: save.execute(input), calls };
	}

	it("POSTs a form-encoded url to the cookie-authenticated save endpoint and confirms a save", async () => {
		const { result, calls } = runSave(
			{ url: "https://example.com/post" },
			SAVED_RESPONSE,
		);

		expect((await result).content[0].text).toBe(
			"Saved to your Readplace reading queue: https://example.com/post",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("/queue/save");
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.headers["content-type"]).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(calls[0].init.headers.accept).toBeUndefined();
		expect(calls[0].init.body).toBe("url=https%3A%2F%2Fexample.com%2Fpost");
	});

	it.each<[string, WebMcpResponse, string]>([
		[
			"a sign-in redirect",
			{ status: 200, url: "https://readplace.com/login" },
			"Sign in to Readplace first, then ask again to save this article.",
		],
		[
			"an inactive-subscription redirect",
			{ status: 200, url: "https://readplace.com/queue?inactive=1" },
			"This Readplace subscription is inactive. Reactivate it to save new articles.",
		],
		[
			"a save-failed redirect",
			{ status: 200, url: "https://readplace.com/queue?error_code=save_failed" },
			"Couldn't save the article to Readplace right now — please try again in a moment.",
		],
		[
			"an unsaveable-url 422",
			{ status: 422, url: "https://readplace.com/queue/save" },
			"That URL can't be saved to Readplace: https://example.com/post",
		],
		[
			"an unexpected status",
			{ status: 500, url: "https://readplace.com/queue/save" },
			"Couldn't save the article to Readplace (HTTP 500).",
		],
	])("maps %s to a human-readable message", async (_label, response, message) => {
		const { result } = runSave({ url: "https://example.com/post" }, response);
		expect((await result).content[0].text).toBe(message);
	});

	it("returns a connection error message when the request itself rejects", async () => {
		const failingFetch: WebMcpFetch = () =>
			Promise.reject(new Error("network down"));
		const { deps } = makeDeps({ fetchFn: failingFetch });
		const save = toolByName(buildReadplaceTools(deps), "save_article");

		expect(
			(await save.execute({ url: "https://example.com/post" })).content[0].text,
		).toBe(
			"Couldn't reach Readplace right now — check your connection and try again.",
		);
	});

	it("asks for a URL and skips the request when none is provided", async () => {
		const { fetchFn, calls } = fetchReturning(SAVED_RESPONSE);
		const { deps } = makeDeps({ fetchFn });
		const save = toolByName(buildReadplaceTools(deps), "save_article");

		expect((await save.execute({})).content[0].text).toBe(
			"Provide the full http(s) URL of the article you want to save.",
		);
		expect(calls).toHaveLength(0);
	});

	it.each([
		["a non-string url", { url: 123 }],
		["a null input", null],
		["a non-object input", "https://example.com"],
	])("treats %s as a missing url", async (_label, input) => {
		const { result, calls } = runSave(input, SAVED_RESPONSE);
		expect((await result).content[0].text).toBe(
			"Provide the full http(s) URL of the article you want to save.",
		);
		expect(calls).toHaveLength(0);
	});
});

describe("open_reading_queue execute", () => {
	function runOpen(input: unknown, overrides: Partial<WebMcpDeps> = {}) {
		const { deps, navigations } = makeDeps(overrides);
		const open = toolByName(buildReadplaceTools(deps), "open_reading_queue");
		return { result: open.execute(input), navigations };
	}

	it("navigates to the read tab when filter is 'read'", async () => {
		const { result, navigations } = runOpen({ filter: "read" });

		expect((await result).content[0].text).toBe(
			"Opening the articles you've already read in Readplace.",
		);
		expect(navigations).toEqual(["/queue?tab=done"]);
	});

	it.each([
		["unread", { filter: "unread" }],
		["an unknown filter", { filter: "archived" }],
		["no filter", {}],
	])("navigates to the default queue for %s", async (_label, input) => {
		const { result, navigations } = runOpen(input);

		expect((await result).content[0].text).toBe(
			"Opening your Readplace reading queue.",
		);
		expect(navigations).toEqual(["/queue"]);
	});

	it.each([
		["the read tab", { filter: "read" }],
		["the default queue", {}],
	])(
		"tells a signed-out agent to sign in first and routes it to /login for %s",
		async (_label, input) => {
			const { result, navigations } = runOpen(input, {
				isAuthenticated: () => false,
			});

			expect((await result).content[0].text).toBe(
				"Sign in to Readplace first, then ask again to open your reading queue.",
			);
			expect(navigations).toEqual(["/login"]);
		},
	);
});

describe("provideWebMcpTools", () => {
	it("no-ops when the browser has no modelContext", () => {
		const { deps } = makeDeps({ modelContext: undefined });
		expect(provideWebMcpTools(deps)).toBe("none");
	});

	it("prefers provideContext, handing it the full tool set", () => {
		let provided: readonly WebMcpTool[] | undefined;
		const modelContext: WebMcpModelContext = {
			provideContext: (context) => {
				provided = context.tools;
			},
		};
		const { deps } = makeDeps({ modelContext });

		expect(provideWebMcpTools(deps)).toBe("provideContext");
		expect(provided?.map((t) => t.name)).toEqual([
			"save_article",
			"open_reading_queue",
		]);
	});

	it("falls back to registerTool for hosts that only expose the imperative API", () => {
		const registered: string[] = [];
		const modelContext: WebMcpModelContext = {
			registerTool: (tool) => {
				registered.push(tool.name);
			},
		};
		const { deps } = makeDeps({ modelContext });

		expect(provideWebMcpTools(deps)).toBe("registerTool");
		expect(registered).toEqual(["save_article", "open_reading_queue"]);
	});

	it("no-ops when modelContext exposes neither registration method", () => {
		const { deps } = makeDeps({ modelContext: {} });
		expect(provideWebMcpTools(deps)).toBe("none");
	});
});
