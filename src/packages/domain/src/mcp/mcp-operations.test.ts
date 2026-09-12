import assert from "node:assert/strict";
import {
	MCP_OPERATIONS,
	mcpOperationMetadata,
	mcpOperationsWithEffect,
} from "./mcp-operations";

describe("MCP operations", () => {
	it("hands an MCP client only the fields that belong on the wire", () => {
		assert.deepEqual(mcpOperationMetadata("list_readlists"), {
			name: "list_readlists",
			title: "List the user's readlists",
			description:
				"List the user's Readplace readlists. Each entry carries an opaque `id` and the `name` the user gave it, and the first is All, the built-in readlist that receives every save. An article removed from All can still belong to another readlist. Pass an `id` to list_readlist_articles to list only that readlist, to save_link to file a new save into it, or to add_to_readlist to file an article that is already saved. Read the id from here rather than deriving one from a name.",
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
			"list_readlists",
			"list_readlist_articles",
			"get_article",
			"get_article_content",
			"get_article_summary",
			"get_related_articles",
			"create_readlist",
			"add_to_readlist",
			"mark_as_read",
			"mark_as_unread",
		]);
		assert.deepEqual(appOnly, ["delete_article"]);
		assert.equal(performed.length + appOnly.length, MCP_OPERATIONS.length);
	});

	it("counts the readlist writes and reading-status tools as writes the assistant makes itself", () => {
		assert.deepEqual(
			mcpOperationsWithEffect("update").map((operation) => operation.name),
			["create_readlist", "add_to_readlist", "mark_as_read", "mark_as_unread"],
		);
	});

	it("keeps the retired queue vocabulary off every agent-visible field", () => {
		for (const operation of MCP_OPERATIONS) {
			for (const field of [
				operation.name,
				operation.title,
				operation.description,
				operation.summary,
			]) {
				assert.equal(
					field.includes("queue"),
					false,
					`"${operation.name}" leaks the word queue: ${field}`,
				);
			}
		}
	});
});
