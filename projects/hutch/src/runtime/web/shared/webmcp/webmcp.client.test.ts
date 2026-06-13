import {
	buildReadplaceTools,
	provideWebMcpTools,
	type WebMcpDeps,
	type WebMcpFetch,
	type WebMcpModelContext,
	type WebMcpTool,
} from "./webmcp.client";

function fetchReturning(status: number): {
	fetchFn: WebMcpFetch;
	calls: Array<{ url: string; init: Parameters<WebMcpFetch>[1] }>;
} {
	const calls: Array<{ url: string; init: Parameters<WebMcpFetch>[1] }> = [];
	const fetchFn: WebMcpFetch = (url, init) => {
		calls.push({ url, init });
		return Promise.resolve({ status });
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
		fetchFn: () => Promise.resolve({ status: 201 }),
		navigate: (url) => navigations.push(url),
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
	function runSave(input: unknown, status: number) {
		const { fetchFn, calls } = fetchReturning(status);
		const { deps } = makeDeps({ fetchFn });
		const save = toolByName(buildReadplaceTools(deps), "save_article");
		return { result: save.execute(input), calls };
	}

	it("POSTs the url to the queue Siren endpoint and confirms a 201 save", async () => {
		const { result, calls } = runSave({ url: "https://example.com/post" }, 201);

		expect((await result).content[0].text).toBe(
			"Saved to your Readplace reading queue: https://example.com/post",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("/queue");
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.headers.accept).toBe("application/vnd.siren+json");
		expect(calls[0].init.headers["content-type"]).toBe("application/json");
		expect(JSON.parse(calls[0].init.body)).toEqual({ url: "https://example.com/post" });
	});

	it.each([
		[401, "Sign in to Readplace first, then ask again to save this article."],
		[403, "Sign in to Readplace first, then ask again to save this article."],
		[
			402,
			"This Readplace subscription is inactive. Reactivate it to save new articles.",
		],
		[422, "That URL can't be saved to Readplace: https://example.com/post"],
		[500, "Couldn't save the article to Readplace (HTTP 500)."],
	])("maps HTTP %i to a human-readable message", async (status, message) => {
		const { result } = runSave({ url: "https://example.com/post" }, status);
		expect((await result).content[0].text).toBe(message);
	});

	it("asks for a URL and skips the request when none is provided", async () => {
		const { fetchFn, calls } = fetchReturning(201);
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
		const { result, calls } = runSave(input, 201);
		expect((await result).content[0].text).toBe(
			"Provide the full http(s) URL of the article you want to save.",
		);
		expect(calls).toHaveLength(0);
	});
});

describe("open_reading_queue execute", () => {
	function runOpen(input: unknown) {
		const { deps, navigations } = makeDeps();
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
