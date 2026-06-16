import {
	LIST_QUEUE_TOOL,
	ListQueueArgs,
	SAVE_LINK_TOOL,
	SaveLinkArgs,
	TOOL_DEFINITIONS,
} from "./tool-definitions";

describe("MCP tool definitions", () => {
	it("exposes save_link and list_queue", () => {
		expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
			"save_link",
			"list_queue",
		]);
	});

	describe("save_link", () => {
		it("requires a non-empty url in both the JSON Schema and the validator", () => {
			expect(SAVE_LINK_TOOL.inputSchema).toMatchObject({
				required: ["url"],
				properties: { url: { type: "string" } },
			});
			expect(SaveLinkArgs.safeParse({ url: "https://example.com/" }).success).toBe(true);
			expect(SaveLinkArgs.safeParse({}).success).toBe(false);
			expect(SaveLinkArgs.safeParse({ url: "" }).success).toBe(false);
		});
	});

	describe("list_queue", () => {
		it("accepts an optional unread/read status in both shapes", () => {
			expect(LIST_QUEUE_TOOL.inputSchema).toMatchObject({
				properties: { status: { enum: ["unread", "read"] } },
			});
			expect(ListQueueArgs.safeParse({}).success).toBe(true);
			expect(ListQueueArgs.safeParse({ status: "unread" }).success).toBe(true);
			expect(ListQueueArgs.safeParse({ status: "read" }).success).toBe(true);
			expect(ListQueueArgs.safeParse({ status: "archived" }).success).toBe(false);
		});
	});
});
