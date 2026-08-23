import {
	buildReadplaceTools,
	initWebMcp,
	type ModelContextLike,
} from "./webmcp.client";

describe("buildReadplaceTools", () => {
	it("exposes a single save_link tool with a url input schema", () => {
		const tools = buildReadplaceTools(() => {});
		expect(tools.map((tool) => tool.name)).toEqual(["save_link"]);
		expect(tools[0].inputSchema).toMatchObject({ required: ["url"] });
	});

	describe("save_link.execute", () => {
		it("navigates to the /save entrypoint for a valid http(s) url", async () => {
			const navigateTo = jest.fn();
			const [saveLink] = buildReadplaceTools(navigateTo);
			const result = await saveLink.execute({ url: "https://example.com/post?x=1" });
			expect(navigateTo).toHaveBeenCalledWith(
				`/save?url=${encodeURIComponent("https://example.com/post?x=1")}&save_surface=webmcp`,
			);
			expect(result).toMatchObject({
				content: [{ type: "text", text: expect.stringContaining("Saving") }],
			});
			expect(result.isError).toBeUndefined();
		});

		it("returns an error result and does not navigate for a non-string url", async () => {
			const navigateTo = jest.fn();
			const [saveLink] = buildReadplaceTools(navigateTo);
			const result = await saveLink.execute({ url: 42 });
			expect(navigateTo).not.toHaveBeenCalled();
			expect(result.isError).toBe(true);
		});

		it("rejects a non-http(s) url scheme", async () => {
			const navigateTo = jest.fn();
			const [saveLink] = buildReadplaceTools(navigateTo);
			const result = await saveLink.execute({ url: "ftp://example.com/x" });
			expect(navigateTo).not.toHaveBeenCalled();
			expect(result.isError).toBe(true);
		});

		it("rejects a malformed url string", async () => {
			const [saveLink] = buildReadplaceTools(() => {});
			const result = await saveLink.execute({ url: "not a url" });
			expect(result.isError).toBe(true);
		});

		it("rejects input that is not an object", async () => {
			const [saveLink] = buildReadplaceTools(() => {});
			const result = await saveLink.execute("https://example.com/");
			expect(result.isError).toBe(true);
		});
	});
});

describe("initWebMcp", () => {
	it("returns false when no model context is present", () => {
		expect(initWebMcp({ modelContext: null, navigateTo: () => {} })).toBe(false);
		expect(initWebMcp({ modelContext: undefined, navigateTo: () => {} })).toBe(false);
	});

	it("uses provideContext when available, passing all tools at once", () => {
		const provideContext = jest.fn();
		const modelContext: ModelContextLike = { provideContext };
		expect(initWebMcp({ modelContext, navigateTo: () => {} })).toBe(true);
		expect(provideContext).toHaveBeenCalledWith({
			tools: expect.arrayContaining([
				expect.objectContaining({ name: "save_link" }),
			]),
		});
	});

	it("falls back to registerTool, registering each tool", () => {
		const registerTool = jest.fn();
		const modelContext: ModelContextLike = { registerTool };
		expect(initWebMcp({ modelContext, navigateTo: () => {} })).toBe(true);
		expect(registerTool).toHaveBeenCalledTimes(1);
		expect(registerTool).toHaveBeenCalledWith(
			expect.objectContaining({ name: "save_link" }),
		);
	});

	it("returns false when the context exposes neither API", () => {
		expect(initWebMcp({ modelContext: {}, navigateTo: () => {} })).toBe(false);
	});
});
