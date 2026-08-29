import assert from "node:assert/strict";
import {
	MCP_OPERATIONS,
	mcpOperationMetadata,
	mcpOperationsWithEffect,
} from "./mcp-operations";

describe("MCP operations", () => {
	it("hands an MCP client only the fields that belong on the wire", () => {
		assert.deepEqual(mcpOperationMetadata("save_link"), {
			name: "save_link",
			title: "Save a link to Readplace",
			description:
				"Save a web page (article, blog post, or PDF) to the user's Readplace reading readlist so they can read it later. The page's title, excerpt, and reader view are fetched in the background after saving.",
		});
	});

	it("splits the operations an assistant performs from the one the app owns", () => {
		const performed = [
			...mcpOperationsWithEffect("save"),
			...mcpOperationsWithEffect("read"),
			...mcpOperationsWithEffect("update"),
		].map((operation) => operation.name);
		const appOnly = mcpOperationsWithEffect("appOnly").map(
			(operation) => operation.name,
		);

		assert.deepEqual(performed, [
			"save_link",
			"list_queue",
			"get_article",
			"get_article_content",
			"get_article_summary",
			"get_related_articles",
			"mark_as_read",
			"mark_as_unread",
		]);
		assert.deepEqual(appOnly, ["delete_article"]);
		assert.equal(performed.length + appOnly.length, MCP_OPERATIONS.length);
	});

	it("counts the two reading-status tools as writes the assistant makes itself", () => {
		assert.deepEqual(
			mcpOperationsWithEffect("update").map((operation) => operation.name),
			["mark_as_read", "mark_as_unread"],
		);
	});
});
