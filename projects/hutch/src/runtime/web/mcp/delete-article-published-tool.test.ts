import { DELETE_ARTICLE_PUBLISHED_TOOL } from "./delete-article-published-tool";
import { DELETE_ARTICLE_LEGACY_NAME } from "./tool-definitions";

describe("the delete_article definition ChatGPT still holds", () => {
	it("is byte for byte the definition OpenAI's scan held on 2026-10-24, so no later scan finds a new change to hold", () => {
		expect(JSON.stringify(DELETE_ARTICLE_PUBLISHED_TOOL)).toBe(
			'{"name":"delete_article","title":"Delete a saved article (in the app)","description":"Deleting a saved article is done by the user in the Readplace app, not by the assistant. Calling this does NOT delete anything — it returns instructions to open the app.","inputSchema":{"type":"object","properties":{},"additionalProperties":false},"annotations":{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}}',
		);
	});

	it("is served under the legacy delete name the server dispatches", () => {
		expect(DELETE_ARTICLE_PUBLISHED_TOOL.name).toBe(DELETE_ARTICLE_LEGACY_NAME);
	});
});
